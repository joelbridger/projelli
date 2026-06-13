/**
 * AppShellNav — chooses the shell navigation. Behind the ?shell=new flag it
 * renders the matter-centric navy Spine (the reimagined experience); otherwise
 * the production Sidebar. A thin swap so App.tsx changes by a single word and
 * the production default + its tests are untouched.
 */
import { Sidebar, type SidebarProps } from '@/components/layout/Sidebar';
import { ReimaginedSpine } from '@/components/layout/ReimaginedSpine';

function useReimaginedShell(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('shell');
  } catch {
    return false;
  }
}

export function AppShellNav(props: SidebarProps) {
  if (useReimaginedShell()) {
    return (
      <ReimaginedSpine
        activeTab={props.activeTab}
        onTabChange={props.onTabChange as ((t: string) => void) | undefined}
        collapsed={props.collapsed}
        onCollapsedChange={props.onCollapsedChange}
        fileTreeContent={props.fileTreeContent}
        searchContent={props.searchContent}
        workflowContent={props.workflowContent}
        aiAssistantContent={props.aiAssistantContent}
        auditContent={props.auditContent}
        trashContent={props.trashContent}
        mattersContent={props.mattersContent}
      />
    );
  }
  return <Sidebar {...props} />;
}
