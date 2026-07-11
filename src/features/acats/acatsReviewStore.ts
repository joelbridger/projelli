import { create } from 'zustand';
import {
  getAcatsReviewBlockingItems,
  isAcatsDraftReadyForApproval,
  type AcatsAcknowledgedWarnings,
  type AcatsConfirmedFields,
} from './reviewRules';
import { auditAcatsDraftApproval } from './audit';
import type {
  AcatsAssetAction,
  AcatsRegistrationType,
  AcatsTransferDraft,
  AcatsTransferType,
  ExtractedField,
} from './types';

type EditableAcatsValue = string;

interface AcatsReviewState {
  draft: AcatsTransferDraft | null;
  confirmedFields: AcatsConfirmedFields;
  acknowledgedWarnings: AcatsAcknowledgedWarnings;
  originalFields: Record<string, ExtractedField<unknown>>;
  isApprovingDraft: boolean;
  setDraft: (draft: AcatsTransferDraft) => void;
  editField: (path: string, value: EditableAcatsValue) => void;
  confirmField: (path: string) => void;
  unconfirmField: (path: string) => void;
  acknowledgeWarning: (warning: string) => void;
  unacknowledgeWarning: (warning: string) => void;
  setTransferType: (transferType: AcatsTransferType) => void;
  setAssetAction: (assetIndex: number, action: AcatsAssetAction) => void;
  approveDraft: () => Promise<void>;
  blockingItems: () => string[];
  isReadyForApproval: () => boolean;
  resetAcatsReview: () => void;
}

function cloneDraft(draft: AcatsTransferDraft): AcatsTransferDraft {
  return {
    ...draft,
    deliveringFirm: { ...draft.deliveringFirm },
    deliveringAccount: {
      ...draft.deliveringAccount,
      owners: [...draft.deliveringAccount.owners],
    },
    receivingSchwabAccount: { ...draft.receivingSchwabAccount },
    instruction: { ...draft.instruction },
    assets: draft.assets.map((asset) => ({ ...asset, warnings: [...asset.warnings] })),
    missingFields: [...draft.missingFields],
    warnings: [...draft.warnings],
  };
}

function readField(draft: AcatsTransferDraft, path: string): ExtractedField<unknown> | undefined {
  switch (path) {
    case 'deliveringFirm.name':
      return draft.deliveringFirm.name;
    case 'deliveringAccount.accountNumber':
      return draft.deliveringAccount.accountNumber;
    case 'deliveringAccount.accountTitle':
      return draft.deliveringAccount.accountTitle;
    case 'deliveringAccount.registrationType':
      return draft.deliveringAccount.registrationType;
    case 'sourceStatementDate':
      return draft.sourceStatementDate;
    default:
      break;
  }
  const assetMatch = path.match(/^assets\.(\d+)\.(description|symbol|cusip|quantity|marketValue|assetType)$/);
  if (!assetMatch) return undefined;
  const index = Number(assetMatch[1]);
  const key = assetMatch[2] as 'description' | 'symbol' | 'cusip' | 'quantity' | 'marketValue' | 'assetType';
  return draft.assets[index]?.[key];
}

function advisorEditedField(
  draft: AcatsTransferDraft,
  original: ExtractedField<unknown> | undefined,
  value: EditableAcatsValue,
): ExtractedField<EditableAcatsValue> {
  return {
    value,
    confidence: 1,
    source: {
      path: original?.source.path ?? draft.sourceStatementPath,
      ...(original?.source.page ? { page: original.source.page } : {}),
      ...(original?.source.textSnippet ? { textSnippet: original.source.textSnippet } : {}),
      extraction: 'advisor-edited',
    },
  };
}

function writeField(
  draft: AcatsTransferDraft,
  path: string,
  field: ExtractedField<EditableAcatsValue>,
): AcatsTransferDraft {
  const next = cloneDraft(draft);
  switch (path) {
    case 'deliveringFirm.name':
      next.deliveringFirm.name = field;
      break;
    case 'deliveringAccount.accountNumber':
      next.deliveringAccount.accountNumber = field;
      break;
    case 'deliveringAccount.accountTitle':
      next.deliveringAccount.accountTitle = field;
      break;
    case 'deliveringAccount.registrationType':
      next.deliveringAccount.registrationType = field as ExtractedField<AcatsRegistrationType>;
      break;
    case 'sourceStatementDate':
      next.sourceStatementDate = field;
      break;
    default: {
      const assetMatch = path.match(/^assets\.(\d+)\.(description|symbol|cusip|quantity|marketValue|assetType)$/);
      if (!assetMatch) return draft;
      const index = Number(assetMatch[1]);
      const key = assetMatch[2] as 'description' | 'symbol' | 'cusip' | 'quantity' | 'marketValue' | 'assetType';
      const asset = next.assets[index];
      if (!asset) return draft;
      if (key === 'description') {
        asset.description = field;
      } else {
        asset[key] = field;
      }
      break;
    }
  }
  return next;
}

export const useAcatsReviewStore = create<AcatsReviewState>((set, get) => ({
  draft: null,
  confirmedFields: {},
  acknowledgedWarnings: {},
  originalFields: {},
  isApprovingDraft: false,
  setDraft: (draft) => {
    set((state) => {
      if (state.isApprovingDraft) return state;
      return {
        draft: cloneDraft(draft),
        confirmedFields: {},
        acknowledgedWarnings: {},
        originalFields: {},
        isApprovingDraft: false,
      };
    });
  },
  editField: (path, value) => {
    set((state) => {
      if (state.isApprovingDraft) return state;
      if (!state.draft) return state;
      const original = readField(state.draft, path);
      const nextOriginalFields = {
        ...state.originalFields,
        ...(original && !state.originalFields[path] ? { [path]: original } : {}),
      };
      return {
        draft: writeField(state.draft, path, advisorEditedField(state.draft, original, value)),
        originalFields: nextOriginalFields,
        confirmedFields: {
          ...state.confirmedFields,
          [path]: true,
        },
      };
    });
  },
  confirmField: (path) => {
    set((state) => {
      if (state.isApprovingDraft) return state;
      return {
        confirmedFields: { ...state.confirmedFields, [path]: true },
      };
    });
  },
  unconfirmField: (path) => {
    set((state) => {
      if (state.isApprovingDraft) return state;
      const { [path]: _removed, ...rest } = state.confirmedFields;
      return { confirmedFields: rest };
    });
  },
  acknowledgeWarning: (warning) => {
    set((state) => {
      if (state.isApprovingDraft) return state;
      return {
        acknowledgedWarnings: { ...state.acknowledgedWarnings, [warning]: true },
      };
    });
  },
  unacknowledgeWarning: (warning) => {
    set((state) => {
      if (state.isApprovingDraft) return state;
      const { [warning]: _removed, ...rest } = state.acknowledgedWarnings;
      return { acknowledgedWarnings: rest };
    });
  },
  setTransferType: (transferType) => {
    set((state) => {
      if (state.isApprovingDraft) return state;
      if (!state.draft) return state;
      return {
        draft: {
          ...cloneDraft(state.draft),
          instruction: {
            ...state.draft.instruction,
            transferType,
          },
          missingFields: state.draft.missingFields.filter((field) => field !== 'Transfer type'),
        },
      };
    });
  },
  setAssetAction: (assetIndex, action) => {
    set((state) => {
      if (state.isApprovingDraft) return state;
      if (!state.draft) return state;
      const draft = cloneDraft(state.draft);
      const asset = draft.assets[assetIndex];
      if (!asset) return state;
      const assetKey = String(assetIndex);
      asset.action = action;
      return {
        draft,
        confirmedFields: {
          ...state.confirmedFields,
          [`assets.${assetKey}.action`]: true,
        },
      };
    });
  },
  approveDraft: async () => {
    const state = get();
    if (state.isApprovingDraft || !isAcatsDraftReadyForApproval(state) || !state.draft) return;
    const draftToApprove = cloneDraft(state.draft);
    set({ isApprovingDraft: true });
    try {
      await auditAcatsDraftApproval(draftToApprove);
      set((latestState) => {
        if (!latestState.draft || latestState.draft.id !== draftToApprove.id) return latestState;
        if (!isAcatsDraftReadyForApproval(latestState)) return latestState;
        return {
          draft: {
            ...cloneDraft(latestState.draft),
            reviewStatus: 'approved',
          },
        };
      });
    } finally {
      set({ isApprovingDraft: false });
    }
  },
  blockingItems: () => getAcatsReviewBlockingItems(get()),
  isReadyForApproval: () => isAcatsDraftReadyForApproval(get()),
  resetAcatsReview: () => {
    set((state) => {
      if (state.isApprovingDraft) return state;
      return {
        draft: null,
        confirmedFields: {},
        acknowledgedWarnings: {},
        originalFields: {},
        isApprovingDraft: false,
      };
    });
  },
}));
