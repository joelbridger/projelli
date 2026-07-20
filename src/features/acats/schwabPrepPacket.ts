import { BaseCommand, type CommandData } from '@/platform/history/Command';
import { resolveUniqueName } from '@/platform/utils/fileDrop';
import { markdownToDocxBytes } from '@/platform/utils/docx-io';
import {
  fieldValue,
  sanitizedFilePart,
} from './format';
import { auditSchwabPrepPacketExport } from './audit';
import type { AcatsTransferDraft } from './types';
import { BRAND } from '@/config/brand';

export { buildAcatsApprovalAuditMetadata } from './audit';

export interface BinaryWorkspaceWriter {
  exists(path: string): Promise<boolean>;
  readFileBinary(path: string): Promise<ArrayBuffer>;
  writeFileBinary(path: string, content: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
}

class WriteBinaryFileCommand extends BaseCommand {
  private previousContent: ArrayBuffer | null = null;
  private fileExisted = false;

  constructor(
    private readonly path: string,
    private readonly content: ArrayBuffer,
    private readonly workspace: BinaryWorkspaceWriter,
  ) {
    super(`Write binary file: ${path}`);
  }

  async execute(): Promise<void> {
    this.fileExisted = await this.workspace.exists(this.path);
    if (this.fileExisted) {
      this.previousContent = await this.workspace.readFileBinary(this.path);
    }
    await this.workspace.writeFileBinary(this.path, this.content);
  }

  async undo(): Promise<void> {
    if (this.fileExisted && this.previousContent) {
      await this.workspace.writeFileBinary(this.path, this.previousContent);
      return;
    }
    await this.workspace.delete(this.path);
  }

  toJSON(): CommandData {
    return {
      id: this.id,
      type: 'WriteBinaryFileCommand',
      description: this.description,
      timestamp: this.timestamp.toISOString(),
      data: {
        path: this.path,
        byteLength: this.content.byteLength,
        fileExisted: this.fileExisted,
      },
    };
  }
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function markdownLine(label: string, value: string | undefined): string {
  return `- **${label}:** ${value?.trim() || 'Needs advisor entry'}`;
}

function assetRows(draft: AcatsTransferDraft): string[] {
  if (draft.assets.length === 0) return ['| Holding | Symbol | CUSIP | Quantity | Market value | Action |', '|---|---|---|---|---|---|', '| Needs advisor entry |  |  |  |  |  |'];
  return [
    '| Holding | Symbol | CUSIP | Quantity | Market value | Action |',
    '|---|---|---|---|---|---|',
    ...draft.assets.map((asset) =>
      `| ${asset.description.value} | ${asset.symbol?.value ?? ''} | ${asset.cusip?.value ?? ''} | ${asset.quantity?.value ?? ''} | ${asset.marketValue?.value ?? ''} | ${asset.action} |`,
    ),
  ];
}

export function buildSchwabPrepPacketMarkdown(draft: AcatsTransferDraft): string {
  const firmName = draft.deliveringFirm.name?.value ?? 'Delivering firm';
  const missing = draft.missingFields.length
    ? draft.missingFields.map((field) => `- [ ] ${field}`)
    : [`- [x] No missing fields flagged by ${BRAND.name}.`];
  const warnings = draft.warnings.length
    ? draft.warnings.map((warning) => `- ${warning}`)
    : [`- No warnings flagged by ${BRAND.name}.`];

  return [
    '# Schwab Prep Packet',
    '',
    '## Handoff note',
    "Use Schwab's approved signing and submission path for authorization and delivery. This packet is preparation only.",
    'Attach the recent delivering-firm statement when Schwab asks for support.',
    '',
    '## Copyable transfer fields',
    markdownLine('Delivering firm', firmName),
    markdownLine('Delivering account number', draft.deliveringAccount.accountNumber?.value),
    markdownLine('Delivering account title', draft.deliveringAccount.accountTitle?.value),
    markdownLine('Delivering registration', fieldValue(draft.deliveringAccount.registrationType)),
    markdownLine('Statement date', draft.sourceStatementDate?.value),
    markdownLine('Transfer type', draft.instruction.transferType === 'unknown' ? '' : draft.instruction.transferType),
    markdownLine('Receiving Schwab account number', draft.receivingSchwabAccount.accountNumber),
    markdownLine('Receiving Schwab account type', draft.receivingSchwabAccount.accountType),
    markdownLine('Receiving Schwab registration', draft.receivingSchwabAccount.registrationType),
    '',
    '## Holdings for partial transfer review',
    ...assetRows(draft),
    '',
    '## Missing-field checklist',
    ...missing,
    '',
    '## Statement attachment reminder',
    '- [ ] Attach the statement used for this extraction.',
    '- [ ] Confirm the statement date is within Schwab guidance before using it.',
    '',
    '## Official-form mapping',
    `| Schwab field area | ${BRAND.name} prep value |`,
    '|---|---|',
    `| Delivering firm | ${firmName} |`,
    `| Delivering account title | ${draft.deliveringAccount.accountTitle?.value ?? ''} |`,
    `| Delivering account number | ${draft.deliveringAccount.accountNumber?.value ?? ''} |`,
    `| Full or partial transfer | ${draft.instruction.transferType} |`,
    '| Statement attachment | Attach the source statement listed above |',
    '',
    '## Advisor warning review',
    ...warnings,
    '',
  ].join('\n');
}

export interface ExportSchwabPrepPacketOptions {
  draft: AcatsTransferDraft;
  workspace: BinaryWorkspaceWriter;
  targetFolder: string;
}

export interface ExportSchwabPrepPacketResult {
  path: string;
  name: string;
}

export async function exportSchwabPrepPacket({
  draft,
  workspace,
  targetFolder,
}: ExportSchwabPrepPacketOptions): Promise<ExportSchwabPrepPacketResult> {
  if (draft.reviewStatus !== 'approved') {
    throw new Error('Approve the ACATS draft before exporting the Schwab Prep Packet.');
  }
  const firmName = sanitizedFilePart(draft.deliveringFirm.name?.value ?? 'Transfer');
  const requestedName = `Schwab Prep Packet - ${firmName}.docx`;
  const finalName = await resolveUniqueName(workspace, targetFolder, requestedName);
  const path = `${targetFolder}/${finalName}`;
  const bytes = await markdownToDocxBytes(buildSchwabPrepPacketMarkdown(draft), finalName);
  await auditSchwabPrepPacketExport(draft, finalName);
  const command = new WriteBinaryFileCommand(path, exactArrayBuffer(bytes), workspace);
  await command.execute();
  return { path, name: finalName };
}
