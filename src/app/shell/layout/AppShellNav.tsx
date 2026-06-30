/**
 * AppShellNav — the matter-centric navy "Spine" navigation (the Advisor Prep Hero 3.0
 * shell). A thin wrapper around <Spine>.
 *
 * The legacy <Sidebar> shell was removed in the 3.0 reorg; the reimagined shell
 * is now the only shell. Two legacy-only props (researchContent, onOpenGridView)
 * are still accepted-and-ignored here — the Spine doesn't render them — pending
 * the dead sidebar-panel cleanup.
 */
import { Spine } from '@/app/shell/layout/Spine';

export type AppShellNavProps = React.ComponentProps<typeof Spine> & {
  researchContent?: React.ReactNode;
  onOpenGridView?: () => void;
};

export function AppShellNav(props: AppShellNavProps) {
  const { researchContent: _researchContent, onOpenGridView: _onOpenGridView, ...spineProps } = props;
  void _researchContent;
  void _onOpenGridView;
  return <Spine {...spineProps} />;
}
