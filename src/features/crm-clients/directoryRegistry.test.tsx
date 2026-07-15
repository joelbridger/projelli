import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type {
  DirectoryActionDescriptor,
  DirectoryContext,
  DirectoryRailDescriptor,
  DirectoryToolDescriptor,
  DirectoryViewDescriptor,
} from './directoryRegistry';
import {
  directoryActionRegistry,
  directoryRailRegistry,
  directoryToolRegistry,
  directoryViewRegistry,
  validateDirectoryActionDescriptors,
  validateDirectoryRailDescriptors,
  validateDirectoryToolDescriptors,
  validateDirectoryViewDescriptors,
} from './directoryRegistry';

declare module './directoryRegistry' {
  interface DirectoryToolIdMap { 'test-tool': true; }
  interface DirectoryActionIdMap { 'test-action': true; }
  interface DirectoryRailIdMap { 'test-rail': true; }
  interface DirectoryViewIdMap { 'test-view': true; }
}

const context: DirectoryContext = {
  query: { value: '', setValue: vi.fn() },
  selection: { person: null, setPerson: vi.fn() },
  sort: { value: 'directory', setValue: vi.fn() },
  filters: { tab: 'households', setTab: vi.fn(), externalOnly: false, setExternalOnly: vi.fn(), needsVerification: false, setNeedsVerification: vi.fn() },
  records: { people: [], households: [] },
  repository: { openHousehold: vi.fn(), reviewRecipient: vi.fn(), createHousehold: vi.fn() },
};

describe('client directory registries', () => {
  it('keeps frozen compatibility descriptors in stable order', () => {
    expect(directoryToolRegistry.map(({ id }) => id)).toEqual(['view-switch', 'tab-switch', 'search', 'external-filter', 'verification-filter']);
    expect(directoryActionRegistry.map(({ id }) => id)).toEqual(['create-household']);
    expect(directoryRailRegistry.map(({ id }) => id)).toEqual(['person-details']);
    expect(directoryViewRegistry.map(({ id }) => id)).toEqual(['directory', 'book']);
  });

  it('mounts one dummy tool, action, rail, and view through their descriptors', () => {
    const tool: DirectoryToolDescriptor = { id: 'test-tool', order: 1, mount: () => <div data-testid="dummy-tool" /> };
    const action: DirectoryActionDescriptor = { id: 'test-action', order: 1, mount: () => <div data-testid="dummy-action" /> };
    const rail: DirectoryRailDescriptor = { id: 'test-rail', order: 1, mount: () => <div data-testid="dummy-rail" /> };
    const view: DirectoryViewDescriptor = { id: 'test-view', order: 1, mount: () => <div data-testid="dummy-view" /> };
    render(<>{tool.mount(context)}{action.mount(context)}{rail.mount(context)}{view.mount(context)}</>);
    expect(screen.getByTestId('dummy-tool')).toBeTruthy();
    expect(screen.getByTestId('dummy-action')).toBeTruthy();
    expect(screen.getByTestId('dummy-rail')).toBeTruthy();
    expect(screen.getByTestId('dummy-view')).toBeTruthy();
  });

  it('rejects duplicate IDs and malformed descriptors clearly', () => {
    const tool = directoryToolRegistry[0];
    const action = directoryActionRegistry[0];
    const rail = directoryRailRegistry[0];
    const view = directoryViewRegistry[0];
    if (!tool || !action || !rail || !view) throw new Error('Expected compatibility descriptors');
    expect(() => { validateDirectoryToolDescriptors([...directoryToolRegistry, tool]); }).toThrow('duplicate id: view-switch');
    expect(() => { validateDirectoryActionDescriptors([...directoryActionRegistry, action]); }).toThrow('duplicate id: create-household');
    expect(() => { validateDirectoryRailDescriptors([...directoryRailRegistry, rail]); }).toThrow('duplicate id: person-details');
    expect(() => { validateDirectoryViewDescriptors([...directoryViewRegistry, view]); }).toThrow('duplicate id: directory');
    expect(() => { validateDirectoryToolDescriptors([{ ...tool, order: Number.NaN }]); }).toThrow('order must be finite: view-switch');
    expect(() => { validateDirectoryViewDescriptors([{ ...view, mount: undefined as never }]); }).toThrow('mount must be a function: directory');
  });

  it('keeps descriptor IDs closed to registered feature augmentations', () => {
    // @ts-expect-error an unregistered directory tool id must not typecheck.
    const typo: DirectoryToolDescriptor = { id: 'test-toool', order: 1, mount: () => null };
    expect(typo).toBeTruthy();
  });
});
