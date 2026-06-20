/**
 * Ch3FilesStayHome — "Your files stay home"
 *
 * Explains local-first storage and lets the user pick a workspace folder.
 * The real folder picker is provided by the host via ctx.actions.chooseWorkspaceFolder.
 *
 * Gate: workspacePath must be set to advance.
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useState } from 'react';
import type { Chapter, ChapterContext, JourneyData } from '../engine/types';
import {
  SceneFrame,
  House,
  Papers,
  Cloud,
} from '../scenes';
import { JOURNEY_STRINGS } from '../copy/strings';
import { ChapterLayout } from './ChapterLayout';

const S = JOURNEY_STRINGS.ch3;

// ---------------------------------------------------------------------------
// canAdvance gate
// ---------------------------------------------------------------------------

function canAdvanceGate(data: JourneyData): boolean {
  return !!data.workspacePath;
}

// ---------------------------------------------------------------------------
// Chapter export
// ---------------------------------------------------------------------------

export const ch3FilesStayHome: Chapter = {
  id: 'files-home',
  title: 'Your files',
  canAdvance: canAdvanceGate,
  render: (ctx) => <Ch3View ctx={ctx} />,
};

// ---------------------------------------------------------------------------
// View component
// ---------------------------------------------------------------------------

interface Ch3ViewProps {
  ctx: ChapterContext;
}

function Ch3View({ ctx }: Ch3ViewProps) {
  // Local mirror so we can show the path immediately after picking.
  const [chosenPath, setChosenPath] = useState<string | undefined>(ctx.data.workspacePath);
  const [picking, setPicking] = useState(false);

  const canAdvance = !!chosenPath;

  const handleChooseFolder = async () => {
    setPicking(true);
    try {
      const path = await ctx.actions.chooseWorkspaceFolder();
      if (path) {
        setChosenPath(path);
        ctx.setData({ workspacePath: path });
      }
    } finally {
      setPicking(false);
    }
  };

  const scene = (
    <SceneFrame label={S.sceneLabel}>
      <div style={{ position: 'relative', width: 140, height: 110 }}>
        {/* House on the left */}
        <div style={{ position: 'absolute', bottom: 0, left: 0 }}>
          <House reducedMotion={ctx.reducedMotion} size={80} />
        </div>
        {/* Papers inside the house */}
        <div style={{ position: 'absolute', bottom: 24, left: 20 }}>
          <Papers reducedMotion={ctx.reducedMotion} size={28} />
        </div>
        {/* Cloud far right, visually disconnected */}
        <div style={{ position: 'absolute', top: 0, right: 0, opacity: 0.4 }}>
          <Cloud reducedMotion={ctx.reducedMotion} size={40} />
        </div>
      </div>
    </SceneFrame>
  );

  return (
    <ChapterLayout
      title={S.title}
      scene={scene}
      onBack={ctx.goBack}
      onContinue={ctx.advance}
      continueDisabled={!canAdvance}
      testId="ch3-root"
    >
      {/* Explanation */}
      <p
        style={{
          fontSize: 'var(--kp-font-base)',
          color: 'var(--color-foreground)',
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        {S.body}
      </p>

      {/* Folder picker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p
          style={{
            fontSize: 'var(--kp-font-base)',
            fontWeight: 'var(--kp-weight-semibold)',
            color: 'var(--color-foreground)',
            margin: 0,
          }}
        >
          {S.folderQuestion}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="ch3-choose-folder"
            onClick={() => void handleChooseFolder()}
            disabled={picking}
            style={{
              padding: '8px 16px',
              fontSize: 'var(--kp-font-sm)',
              fontWeight: 'var(--kp-weight-medium)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              background: 'var(--color-background)',
              color: 'var(--color-foreground)',
              cursor: picking ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {S.chooseFolderBtn}
          </button>

          {chosenPath && (
            <span
              data-testid="ch3-chosen-path"
              style={{
                fontSize: 'var(--kp-font-sm)',
                color: 'var(--kp-navy)',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}
            >
              {chosenPath}
            </span>
          )}
        </div>

        <p
          style={{
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--color-muted-foreground)',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {S.folderNote}
        </p>
      </div>
    </ChapterLayout>
  );
}
