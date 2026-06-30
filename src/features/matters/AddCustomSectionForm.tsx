// src/features/matters/AddCustomSectionForm.tsx
import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '@/ui/kp';
import { buildCustomSection } from '@/platform/clientMap/customSection';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';

const LABEL_ERROR = 'Could not fill this section. Your AI provider may be unavailable, or no account key is set. Nothing was added. Try again.';

export interface AddCustomSectionFormProps {
  matterId: string;
  onAdded?: () => void;
}

export function AddCustomSectionForm({ matterId, onAdded }: AddCustomSectionFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addCustomSection = useClientMapStore((s) => s.addCustomSection);
  const setMap = useClientMapStore((s) => s.setMap);
  const getMap = useClientMapStore((s) => s.getMap);
  const removeSection = useClientMapStore((s) => s.removeSection);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const sectionId = uuidv4();
    try {
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
    } catch {
      // BUG-107: a failed populate must NOT leave a permanently-empty section or
      // an unhandled rejection. Roll back the just-added section and surface a
      // plain-language error; the user's title/description stay so they can retry.
      removeSection(matterId, sectionId);
      setError(LABEL_ERROR);
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
        {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
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
      {error !== null && (
        <p
          data-testid="custom-section-error"
          role="alert"
          style={{ color: '#b91c1c', fontSize: 13, margin: '6px 0 0' }}
        >
          {error}
        </p>
      )}
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
