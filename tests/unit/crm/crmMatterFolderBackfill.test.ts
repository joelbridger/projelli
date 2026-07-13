import { beforeEach, describe, expect, it } from 'vitest';
import {
  attachCrmHouseholdFolderIfUnmapped,
  buildClaimedCrmFolderSet,
} from '@/platform/matter/crmMatterFolderBackfill';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { resolveMatterId } from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';
import { scopeFileTreeToFolders } from '@/features/documents/scopeFileTree';

function resetStores() {
  useMatterStore.setState({
    matters: [],
    activeMatterId: null,
    snapshots: {},
    cache: {},
    statusByMatterId: {},
    clientMapHubId: null,
  });
  useWorkspaceStore.setState({
    rootPath: '/workspace',
    fileTree: [
      {
        id: 'clients',
        name: 'Clients',
        path: '/workspace/Clients',
        type: 'folder',
        children: [
          {
            id: 'ellison',
            name: 'Ellison, Robert & Margaret',
            path: '/workspace/Clients/Ellison, Robert & Margaret',
            type: 'folder',
            children: [
              {
                id: 'ellison-plan',
                name: 'review-plan.docx',
                path: '/workspace/Clients/Ellison, Robert & Margaret/review-plan.docx',
                type: 'file',
              },
            ],
          },
          {
            id: 'hollings',
            name: 'Hollings Family',
            path: '/workspace/Clients/Hollings Family',
            type: 'folder',
            children: [],
          },
          {
            id: 'nakamura',
            name: 'Nakamura, David & Susan',
            path: '/workspace/Clients/Nakamura, David & Susan',
            type: 'folder',
            children: [],
          },
        ],
      },
    ],
  });
}

describe('attachCrmHouseholdFolderIfUnmapped', () => {
  beforeEach(() => {
    resetStores();
  });

  it('backfills the matching document folder when CRM creates a matter after documents were already indexed', () => {
    const docPath = '/workspace/Clients/Ellison, Robert & Margaret/review-plan.docx';

    expect(resolveMatterId(docPath, useMatterStore.getState().matters)).toBe(
      UNASSIGNED_MATTER_ID,
    );

    const created = useMatterStore.getState().createMatter({
      name: 'Ellison, Robert & Margaret',
      client: 'Ellison, Robert & Margaret',
      crmHouseholdKeys: ['wb-ellison'],
      createdFromCrm: true,
    });

    const attached = attachCrmHouseholdFolderIfUnmapped(
      created.id,
      { id: 'wb-ellison', name: 'Ellison, Robert & Margaret' },
      new Set(),
    );

    expect(attached).toBe('/workspace/Clients/Ellison, Robert & Margaret');
    const matter = useMatterStore.getState().matters.find((m) => m.id === created.id);
    expect(matter?.folderPaths).toEqual([
      '/workspace/Clients/Ellison, Robert & Margaret',
    ]);
    expect(resolveMatterId(docPath, useMatterStore.getState().matters)).toBe(
      created.id,
    );
  });

  it('shows files in Documents after CRM backfills a relative client folder', () => {
    const rootPath = 'C:/LanternWorkspaces/Northcrest Wealth Partners';
    useWorkspaceStore.setState({
      rootPath,
      fileTree: [
        {
          id: 'clients',
          name: 'Clients',
          path: 'Clients',
          type: 'folder',
          children: [
            {
              id: 'webb',
              name: 'Webb, Marcus & Tanya',
              path: 'Clients/Webb, Marcus & Tanya',
              type: 'folder',
              children: [
                {
                  id: 'webb-plan',
                  name: '529 plan.docx',
                  path: 'Clients/Webb, Marcus & Tanya/529 plan.docx',
                  type: 'file',
                },
              ],
            },
          ],
        },
      ],
    });

    const created = useMatterStore.getState().createMatter({
      name: 'Webb, Marcus & Tanya',
      client: 'Webb, Marcus & Tanya',
      crmHouseholdKeys: ['wb-webb'],
      createdFromCrm: true,
    });

    expect(
      attachCrmHouseholdFolderIfUnmapped(
        created.id,
        { id: 'wb-webb', name: 'Webb, Marcus & Tanya' },
        new Set(),
      ),
    ).toBe('Clients/Webb, Marcus & Tanya');

    const state = useMatterStore.getState();
    const linkedMatter = state.matters.find((matter) => matter.id === created.id);
    expect(linkedMatter).toBeDefined();

    const scopedTree = scopeFileTreeToFolders(
      useWorkspaceStore.getState().fileTree,
      linkedMatter!.folderPaths,
      state.matters,
      linkedMatter!.id,
      rootPath,
    );
    const clientsFolder = scopedTree.find((node) => node.path === 'Clients');
    const clientFolder = clientsFolder?.children?.find(
      (node) => node.path === 'Clients/Webb, Marcus & Tanya',
    );

    expect(clientFolder?.children?.map((node) => node.path)).toContain(
      'Clients/Webb, Marcus & Tanya/529 plan.docx',
    );
  });

  it('does not attach a folder when the matter already has a folder mapping', () => {
    const existing = useMatterStore.getState().createMatter({
      name: 'Hollings Family',
      client: 'Hollings Family',
      folderPaths: ['/workspace/Manual/Hollings'],
      crmHouseholdKeys: ['wb-hollings'],
      createdFromCrm: true,
    });

    expect(
      attachCrmHouseholdFolderIfUnmapped(
        existing.id,
        { id: 'wb-hollings', name: 'Hollings Family' },
        new Set(),
      ),
    ).toBeNull();
    expect(
      useMatterStore.getState().matters.find((m) => m.id === existing.id)?.folderPaths,
    ).toEqual(['/workspace/Manual/Hollings']);
  });

  it('does not attach a folder already owned by another matter under a different path shape', () => {
    useWorkspaceStore.setState({
      rootPath: 'C:/WS',
      fileTree: [
        {
          id: 'clients',
          name: 'Clients',
          path: 'Clients',
          type: 'folder',
          children: [
            {
              id: 'acme',
              name: 'acme',
              path: 'Clients/acme',
              type: 'folder',
              children: [],
            },
          ],
        },
      ],
    });

    useMatterStore.getState().createMatter({
      name: 'Acme Matter A',
      client: 'Acme',
      folderPaths: ['C:/WS/Clients/Acme'],
    });
    const createdByCrm = useMatterStore.getState().createMatter({
      name: 'Acme',
      client: 'Acme',
      crmHouseholdKeys: ['wb-acme-other'],
      createdFromCrm: true,
    });

    const attached = attachCrmHouseholdFolderIfUnmapped(
      createdByCrm.id,
      { id: 'wb-acme-other', name: 'Acme' },
      buildClaimedCrmFolderSet(),
    );

    expect(attached).toBeNull();
    expect(
      useMatterStore.getState().matters.find((m) => m.id === createdByCrm.id)?.folderPaths,
    ).toEqual([]);
  });

  it('does not attach when existing claims cannot be compared against a known workspace root', () => {
    useWorkspaceStore.setState({
      rootPath: null,
      fileTree: [
        {
          id: 'clients',
          name: 'Clients',
          path: 'Clients',
          type: 'folder',
          children: [
            {
              id: 'acme',
              name: 'Acme',
              path: 'Clients/Acme',
              type: 'folder',
              children: [],
            },
          ],
        },
      ],
    });

    useMatterStore.getState().createMatter({
      name: 'Existing Client',
      client: 'Existing Client',
      folderPaths: ['C:/WS/Existing Client'],
    });
    const createdByCrm = useMatterStore.getState().createMatter({
      name: 'Acme',
      client: 'Acme',
      crmHouseholdKeys: ['wb-acme'],
      createdFromCrm: true,
    });

    expect(
      attachCrmHouseholdFolderIfUnmapped(
        createdByCrm.id,
        { id: 'wb-acme', name: 'Acme' },
        buildClaimedCrmFolderSet(),
      ),
    ).toBeNull();
    expect(
      useMatterStore.getState().matters.find((m) => m.id === createdByCrm.id)?.folderPaths,
    ).toEqual([]);
  });
});
