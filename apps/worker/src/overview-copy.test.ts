import { describe, expect, it } from "vitest";
import { campaignDates, nextAction, performance } from "../../web/app/dashboard/overview-model";
import type { Campaign, Overview } from "../../web/app/dashboard/types";

const empty = (): Overview => ({ campaigns: [], contacts: [], events: [], settings: null, totals: { campaigns: 0, contacts: 0, suppressed: 0, delivered: 0, opened_delivered: 0, sending_campaigns: 0 }, sending: { configured: false, from_email: null, status: "Resend not configured" } });
const campaign = (status = "draft"): Campaign => ({ id: "example", name: "Example", status, total_count: 10, accepted_count: 10, delivered_count: 4, opened_count: 2, clicked_count: 1, failed_count: 0, blocked_count: 0, created_at: "2026-11-01T12:00:00Z" });

describe("operational overview copy", () => {
  it("does not count provider acceptance as delivery", () => {
    const data = empty(); data.totals.accepted = 100;
    expect(performance(data)).toEqual({ delivered: 0, openRate: null, sending: 0 });
  });
  it("uses unique opens among delivered recipients and only actively sending campaigns", () => {
    const data = empty(); Object.assign(data.totals, { delivered: 40, opened: 30, opened_delivered: 20, sending_campaigns: 2, queued: 50 });
    expect(performance(data)).toEqual({ delivered: 40, openRate: 50, sending: 2 });
  });
  it("does not invent values when data is unavailable", () => {
    expect(performance(null)).toEqual({ delivered: null, openRate: null, sending: null });
    expect(nextAction(null).heading).toContain("unavailable");
  });
  it("directs a first-time user to Email Setup", () => { expect(nextAction(empty()).text).toContain("Email Setup"); });
  it("directs a configured sender without recipients to Contacts", () => {
    const data = empty(); data.sending!.configured = true;
    expect(nextAction(data).heading).toBe("Add your first recipients.");
  });
  it("directs an existing audience to the visual builder", () => {
    const data = empty(); data.sending!.configured = true; data.totals.contacts = 2;
    expect(nextAction(data).text).toContain("visual builder");
  });
  it("prioritizes failures over active sends", () => {
    const data = empty(); data.campaigns = [campaign("failed")]; data.totals.sending_campaigns = 2;
    expect(nextAction(data).text).toContain("review recipient failures");
  });
  it("directs active campaigns to monitoring", () => {
    const data = empty(); data.totals.sending_campaigns = 2;
    expect(nextAction(data).heading).toBe("2 campaigns are sending.");
  });
  it("directs completed campaigns to results", () => {
    const data = empty(); data.sending!.configured = true; data.totals.contacts = 2; data.totals.campaigns = 1;
    data.campaigns = [campaign("completed")]; expect(nextAction(data).text).toContain("deliveries, opens, clicks and failures");
  });
  it("uses recorded creation and sending timestamps, not invented scheduling", () => {
    const row = campaign(); expect(campaignDates(row)).toHaveLength(1);
    row.started_at = "2026-11-02T12:00:00Z"; row.completed_at = "2026-11-03T12:00:00Z";
    expect(campaignDates(row).map(event => event.label)).toEqual(["campaign created", "sending started", "sending finished"]);
    row.started_at = null; expect(campaignDates(row).map(event => event.label)).toEqual(["campaign created"]);
  });
});
