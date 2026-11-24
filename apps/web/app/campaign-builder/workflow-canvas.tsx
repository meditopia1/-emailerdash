"use client";

import { useMemo } from "react";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Node, type NodeProps, type ReactFlowInstance, type Viewport } from "@xyflow/react";
import { BarChart3, CheckCircle2, CircleAlert, Flag, GripVertical, Mail, Users } from "lucide-react";
import { formatNumber, statusLabel } from "../dashboard/types";
import { draftIssues, stepLabels, steps, type Audience, type BuilderCampaign, type Draft, type StepId, type WorkflowLayout } from "./model";

type StepData = { title: string; subtitle: string; lines: [string, string][]; warning: string | null; step: StepId; monitor: boolean };
type WorkflowNode = Node<StepData, "campaignStep">;
const nodeIcons = { start: Flag, audience: Users, email: Mail, results: BarChart3 };

function CampaignNode({ data, selected }: NodeProps<WorkflowNode>) {
  const NodeIcon = nodeIcons[data.step];
  return <div className={`workflow-node category-${data.step}${selected ? " selected" : ""}`}>
    {data.step !== "start" && <Handle type="target" position={data.step === "email" ? Position.Top : data.step === "results" ? Position.Right : Position.Left} isConnectable={false} />}
    <div className="workflow-node-heading"><span className="workflow-node-icon"><NodeIcon size={17} /></span><span>{stepLabels[data.step]}</span><GripVertical size={14} className="node-grip" /></div>
    <div className="workflow-node-body"><strong className="workflow-node-title">{data.title}</strong><span className="workflow-node-subtitle">{data.subtitle}</span><div className="workflow-node-lines">{data.lines.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></div>
    <div className={`workflow-node-footer${data.warning ? " warning" : ""}`}>{data.warning ? <CircleAlert size={13} /> : <CheckCircle2 size={13} />}<span>{data.warning || (data.monitor ? "Live campaign data" : "Configuration complete")}</span><span className="node-step-number">0{steps.indexOf(data.step) + 1}</span></div>
    {data.step !== "results" && <Handle type="source" position={data.step === "audience" ? Position.Bottom : data.step === "email" ? Position.Left : Position.Right} isConnectable={false} />}
  </div>;
}

const nodeTypes = { campaignStep: CampaignNode };
const edges = steps.slice(0, -1).map((id, index) => ({ id: `${id}-${steps[index + 1]}`, source: id, target: steps[index + 1], type: "smoothstep", selectable: false, deletable: false, reconnectable: false, markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 }, style: { strokeWidth: 1.3 } }));

export default function WorkflowCanvas({ draft, campaign, audience, checking, layout, selected, onSelect, onPosition, onViewport, onInit, theme }: { draft: Draft; campaign: BuilderCampaign | null; audience: Audience; checking: boolean; layout: WorkflowLayout; selected: StepId; onSelect: (id: StepId) => void; onPosition: (id: StepId, position: { x: number; y: number }) => void; onViewport: (viewport: Viewport) => void; onInit: (instance: ReactFlowInstance<WorkflowNode>) => void; theme: "light" | "dark" }) {
  const nodes = useMemo<WorkflowNode[]>(() => {
    const monitor = Boolean(campaign && campaign.status !== "draft");
    const emailIssues = draftIssues(draft).filter(issue => !issue.includes("campaign name"));
    const data: Record<StepId, Omit<StepData, "step" | "monitor">> = {
      start: { title: draft.name || "Untitled campaign", subtitle: campaign ? `Created ${new Date(campaign.created_at).toLocaleDateString()}` : "Your next conversation starts here", lines: [["Status", statusLabel(campaign?.status ?? "draft")], ["Sending", monitor ? statusLabel(campaign!.status) : "Not queued"]], warning: draft.name.trim() ? null : "Add a campaign name" },
      audience: { title: `${formatNumber(monitor ? campaign!.total_count : draft.audience_contact_ids.length)} recipients`, subtitle: "Saved contacts · consent required", lines: [["Eligible", checking ? "Checking…" : formatNumber(audience.eligible)], ["Excluded", checking ? "Checking…" : formatNumber(audience.excluded)]], warning: monitor ? null : !draft.audience_contact_ids.length ? "Select your audience" : checking ? "Checking eligibility" : audience.excluded ? `${audience.excluded} contacts excluded` : null },
      email: { title: draft.subject || "Your email subject", subtitle: draft.from_email || "Sender not configured", lines: [["Format", draft.content_format === "html" ? "HTML" : "Plain text"], ["Template", "Campaign content"]], warning: emailIssues[0] ?? null },
      results: { title: monitor ? statusLabel(campaign!.status) : "Campaign readiness", subtitle: monitor ? "Acceptance and delivery tracked separately" : "Review before submitting", lines: monitor ? [["Accepted", formatNumber(campaign!.accepted_count)], ["Delivered", formatNumber(campaign!.delivered_count)], ["Failed", formatNumber(campaign!.failed_count)]] : [["Selected", formatNumber(draft.audience_contact_ids.length)], ["Content checks", draftIssues(draft).length ? `${draftIssues(draft).length} remaining` : "Complete"]], warning: monitor ? null : "Review before launch" },
    };
    return steps.map(step => ({ id: step, type: "campaignStep", position: layout.positions[step], selected: selected === step, draggable: true, connectable: false, deletable: false, data: { ...data[step], step, monitor }, ariaLabel: `${stepLabels[step]} workflow node` }));
  }, [draft, campaign, audience, checking, layout.positions, selected]);

  return <ReactFlow<WorkflowNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={onInit} defaultViewport={layout.viewport} onNodeClick={(_, node) => onSelect(node.id as StepId)} onNodesChange={changes => { for (const change of changes) { if (change.type === "position" && change.position && steps.includes(change.id as StepId)) onPosition(change.id as StepId, change.position); if (change.type === "select" && change.selected && steps.includes(change.id as StepId)) onSelect(change.id as StepId); } }} onMoveEnd={(_, viewport) => onViewport(viewport)} nodesConnectable={false} edgesReconnectable={false} connectOnClick={false} deleteKeyCode={null} minZoom={.2} maxZoom={2} panOnScroll zoomOnDoubleClick={false} colorMode={theme} fitView={!campaign?.workflow_layout?.version} fitViewOptions={{ padding: .16, maxZoom: 1 }} proOptions={{ hideAttribution: false }}><Background variant={BackgroundVariant.Dots} gap={20} size={1} /><Controls showInteractive={false} /><MiniMap nodeBorderRadius={8} pannable zoomable /><div className="canvas-guide"><span className="builder-state-dot" />Fixed workflow · drag to arrange, scroll to explore</div></ReactFlow>;
}
