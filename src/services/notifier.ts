/**
 * Notifier
 *
 * Delivers alert notifications to external channels (Slack webhook).
 * Handles delivery failures gracefully — a failed notification should never
 * crash the monitoring pipeline.
 */

import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import type { HealthSeverity } from "../utils/health-calc.js";

export interface AlertPayload {
  safeAddress: string;
  severity: HealthSeverity;
  healthFactor: number;
  message: string;
  details: Record<string, unknown>;
}

/** Slack colour mapping for severity levels. */
const SEVERITY_COLORS: Record<string, string> = {
  INFO: "#2196F3",
  WARNING: "#FF9800",
  CRITICAL: "#F44336",
  LIQUIDATABLE: "#B71C1C",
};

const SEVERITY_EMOJI: Record<string, string> = {
  INFO: ":information_source:",
  WARNING: ":warning:",
  CRITICAL: ":rotating_light:",
  LIQUIDATABLE: ":skull:",
};

export class Notifier {
  /**
   * Send an alert to all configured notification channels.
   */
  async sendAlert(payload: AlertPayload): Promise<void> {
    const promises: Promise<void>[] = [];

    if (config.alerts.slackWebhookUrl) {
      promises.push(this.sendSlack(payload));
    }

    if (promises.length === 0) {
      logger.debug(
        { safe: payload.safeAddress, severity: payload.severity },
        "No notification channels configured — alert logged only",
      );
      return;
    }

    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === "rejected") {
        logger.error(
          { error: String(result.reason) },
          "Notification delivery failed",
        );
      }
    }
  }

  /**
   * Send a Slack incoming webhook message formatted as an attachment.
   */
  private async sendSlack(payload: AlertPayload): Promise<void> {
    const hf = isFinite(payload.healthFactor)
      ? payload.healthFactor.toFixed(4)
      : "Infinity";

    const emoji = SEVERITY_EMOJI[payload.severity] ?? "";
    const color = SEVERITY_COLORS[payload.severity] ?? "#757575";

    const details = payload.details as {
      totalCollateralUsd?: number;
      totalDebtUsd?: number;
      maxBorrowUsd?: number;
    };

    const fields = [
      {
        title: "Safe Address",
        value: `\`${payload.safeAddress}\``,
        short: false,
      },
      {
        title: "Severity",
        value: `${emoji} ${payload.severity}`,
        short: true,
      },
      {
        title: "Health Factor",
        value: hf,
        short: true,
      },
    ];

    if (details.totalCollateralUsd != null) {
      fields.push({
        title: "Total Collateral",
        value: `$${details.totalCollateralUsd.toFixed(2)}`,
        short: true,
      });
    }

    if (details.totalDebtUsd != null) {
      fields.push({
        title: "Total Debt",
        value: `$${details.totalDebtUsd.toFixed(2)}`,
        short: true,
      });
    }

    if (details.maxBorrowUsd != null) {
      fields.push({
        title: "Max Borrow",
        value: `$${details.maxBorrowUsd.toFixed(2)}`,
        short: true,
      });
    }

    const slackBody = {
      text: `${emoji} Cash Safe Alert: ${payload.severity}`,
      attachments: [
        {
          color,
          fallback: payload.message,
          title: `Cash Safe Health Alert — ${payload.severity}`,
          text: payload.message,
          fields,
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    try {
      const response = await fetch(config.alerts.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackBody),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Slack webhook returned ${response.status}: ${text}`);
      }

      logger.info(
        { safe: payload.safeAddress, severity: payload.severity },
        "Slack notification sent",
      );
    } catch (error) {
      logger.error(
        {
          safe: payload.safeAddress,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to send Slack notification",
      );
    }
  }
}
