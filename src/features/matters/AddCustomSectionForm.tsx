// src/features/matters/AddCustomSectionForm.tsx
import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '@/ui/kp';
import { buildCustomSection } from '@/platform/clientMap/customSection';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';

export interface AddCustomSectionFormProps {
  matterId: string;
  onAdded?: () => void;
}

export function AddCustomSectionForm({ matterId, onAdded }: AddCustomSectionFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const addCustomSection = useClientMapStore((s) => s.addCustomSection);
  const setMap = useClientMapStore((s) => s.setMap);
  const getMap = useClientMapStore((s) => s.getMap);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const sectionId = uuidv4();
      // Add an empty section immediately so the UI responds fast.
      const empty = {
        id: sectionId,
        kind: 'custom' as const,
        key: sectionId,
        title: title.trim(),
        prompt: description.trim() || title.trim(),
        scope: 'matter' as const,
        items: [],
      };
      addCustomSection(matterId, empty);
      // Then populate it asynchronously.
      const populated = await buildCustomSection(
        matterId,
        sectionId,
        title.trim(),
        description.trim() || title.trim(),
      );
      // Patch the section in place inside the existing map.
      const map = getMap(matterId);
      if (map) {
        setMap(matterId, {
          ...map,
          sections: map.sections.map((sec) => (sec.id === sectionId ? populated : sec)),
        });
      }
      setTitle('');
      setDescription('');
      onAdded?.();
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    void handleSubmit(e);
  }

  return (
    <form onSubmit={onSubmit} data-testid="add-custom-section-form">
      <div>
        <label htmlFor="custom-section-title">Section title</label>
        <input
          id="custom-section-title"
          data-testid="custom-section-title"
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); }}
          placeholder="e.g. Insurance coverage"
        />
      </div>
      <div>
        {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
        <label htmlFor="custom-section-description">What to track (plain language)</label>
        <input
          id="custom-section-description"
          data-testid="custom-section-description"
          type="text"
          value={description}
          onChange={(e) => { setDescription(e.target.value); }}
          placeholder="e.g. track the insurance coverage limits and policy numbers"
        />
      </div>
      <Button
        type="submit"
        data-testid="custom-section-submit"
        disabled={!title.trim() || busy}
        loading={busy}
        size="sm"
      >
        Add section
      </Button>
    </form>
  );
}
