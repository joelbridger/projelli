import { useEffect, useState } from 'react';

import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { useBlueprintStore } from '@/platform/intake/blueprintStore';
import type { RequestBlueprint } from '@/platform/intake/blueprintTypes';
import { FormBuilderEditor } from './FormBuilderEditor';

/* eslint-disable lantern-i18n/no-hardcoded-string -- Form library copy ships with the intake UI. */

export interface FormBuilderLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type LibraryView = 'list' | 'editor';

export function FormBuilderLibrary(props: FormBuilderLibraryProps): React.JSX.Element {
  const listBlueprints = useBlueprintStore((state) => state.listBlueprints);
  // Subscribing to firmBlueprintsById makes this component re-render on every
  // store change; listBlueprints() itself is cheap enough to call directly on
  // each render rather than memoize against a dependency that isn't actually
  // read in the computation (that mismatch is what the removed useMemo had).
  useBlueprintStore((state) => state.firmBlueprintsById);
  const archiveFirmBlueprint = useBlueprintStore((state) => state.archiveFirmBlueprint);
  const blueprints = listBlueprints();
  const [view, setView] = useState<LibraryView>('list');
  const [selectedBlueprint, setSelectedBlueprint] = useState<RequestBlueprint | null>(null);
  const [archiveConfirmationId, setArchiveConfirmationId] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- Every newly opened library starts at its saved-forms list. */
  useEffect(() => {
    if (!props.open) return;
    setView('list');
    setSelectedBlueprint(null);
    setArchiveConfirmationId(null);
  }, [props.open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const startNewForm = () => {
    setSelectedBlueprint(null);
    setArchiveConfirmationId(null);
    setView('editor');
  };

  const startEditing = (blueprint: RequestBlueprint) => {
    setSelectedBlueprint(blueprint);
    setArchiveConfirmationId(null);
    setView('editor');
  };

  const returnToList = () => {
    setSelectedBlueprint(null);
    setArchiveConfirmationId(null);
    setView('list');
  };

  const archive = (blueprintId: string) => {
    archiveFirmBlueprint(blueprintId);
    setArchiveConfirmationId(null);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-[var(--kp-surface-card)]" data-testid="form-builder-library">
        <DialogHeader>
          <DialogTitle>{view === 'list' ? 'Saved forms' : selectedBlueprint ? 'Edit form' : 'New form'}</DialogTitle>
          <DialogDescription>
            {view === 'list'
              ? 'Create and manage the forms you use to request information from clients.'
              : 'Choose what this form asks for, then save it when it is ready.'}
          </DialogDescription>
        </DialogHeader>

        {view === 'list' ? (
          <section className="grid gap-3" aria-label="Saved forms">
            <div className="flex justify-end">
              <Button type="button" onClick={startNewForm}>New form</Button>
            </div>
            {blueprints.map((blueprint) => {
              const isFirmSaved = blueprint.source === 'firm_saved';
              const isConfirmingArchive = archiveConfirmationId === blueprint.blueprintId;
              return (
                <article key={blueprint.blueprintId} className="grid gap-3 rounded-lg border border-[var(--kp-divider)] bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="m-0 text-base font-semibold text-[var(--kp-navy)]">{blueprint.label}</h3>
                      <p className="m-0 mt-1 text-sm text-muted-foreground">{blueprint.items.length} {blueprint.items.length === 1 ? 'item' : 'items'}</p>
                    </div>
                    {blueprint.source === 'built_in' ? (
                      <span className="rounded-full bg-[var(--kp-bg-soft)] px-2 py-1 text-xs font-medium text-[var(--kp-navy)]">Built-in</span>
                    ) : null}
                  </div>

                  {isFirmSaved ? (
                    isConfirmingArchive ? (
                      <div className="flex flex-wrap items-center gap-2" aria-label={`Archive ${blueprint.label}`}>
                        <span className="text-sm text-muted-foreground">Archive this form?</span>
                        <Button type="button" size="sm" variant="destructive" onClick={() => { archive(blueprint.blueprintId); }}>Archive form</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => { setArchiveConfirmationId(null); }}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => { startEditing(blueprint); }}>Edit</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setArchiveConfirmationId(blueprint.blueprintId); }}>Archive</Button>
                      </div>
                    )
                  ) : null}
                </article>
              );
            })}
          </section>
        ) : (
          <FormBuilderEditor blueprint={selectedBlueprint} onSaved={returnToList} onCancel={returnToList} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* eslint-enable lantern-i18n/no-hardcoded-string */
