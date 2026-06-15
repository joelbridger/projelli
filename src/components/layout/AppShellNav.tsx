/**
 * AppShellNav — chooses the shell navigation. Behind the ?shell=new flag it
 * renders the matter-centric navy Spine (the reimagined experience); otherwise
 * the production Sidebar. A thin swap so App.tsx changes by a single word and
 * the production default + its tests are untouched.
 */
import { Sidebar, type SidebarProps } from '@/components/layout/Sidebar';
import { ReimaginedSpine } from '@/components/layout/ReimaginedSpine';
import { isReimaginedShell } from '@/lib/reimaginedShell';

export interface AppShellNavProps extends Omit<SidebarProps, 'activeTab' | 'onTabChange'> {
  emailContent?: React.ReactNode | undefined;
  settingsContent?: React.ReactNode | undefined;
  activeTab?: string | undefined;
  onTabChange?: ((tab: string) => void) | undefined;
}

export function AppShellNav(props: AppShellNavProps) {
  if (isReimaginedShell()) {
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
        emailContent={props.emailContent}
        settingsContent={props.settingsContent}
      />
    );
  }
  // Cast: Sidebar only knows SidebarProps; emailContent is a Spine-only field
  // that Sidebar ignores, and activeTab/onTabChange are narrowed by SidebarProps.
  return <Sidebar {...(props as unknown as SidebarProps)} />;
}
