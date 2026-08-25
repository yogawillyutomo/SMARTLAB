import { describe, expect, it } from 'vitest';
import appSource from '@/App.tsx?raw';
import pageSource from '@/pages/LaboratoryLayoutApiPage.tsx?raw';

describe('production canonical Laboratory Layout route boundary', () => {
  it('routes the canonical Laboratory ULID page behind exact layouts.view permission', () => {
    expect(appSource).toContain('path="/laboratories/:laboratoryId/layout"');
    expect(appSource).toContain('permission="layouts.view"><LaboratoryLayoutApiPage');
    expect(appSource).not.toContain('LaboratoryLayoutUnavailablePage');
    expect(pageSource).toContain('const { laboratoryId } = useParams()');
    expect(pageSource).toContain('loadLayoutWorkspaceData(scope.laboratoryId');
  });

  it('does not import legacy AppDB persistence into the production page', () => {
    expect(pageSource).not.toContain('useAppData');
    expect(pageSource).not.toContain('services/repositories');
    expect(pageSource).not.toContain('domain/laboratory-layout');
    expect(pageSource).not.toContain('localStorage');
    expect(pageSource).toContain("from '@/services/laboratoryApi'");
    expect(pageSource).toContain("from '@/services/layoutApi'");
    expect(pageSource).toContain("from '@/domain/server-layout'");
  });

  it('integrates route-scoped continuations, lazy Device metadata, and GET-only reconciliation', () => {
    expect(pageSource).toContain('new LayoutRouteScope()');
    expect(pageSource).toContain('routeScope.current.isCurrent(scope)');
    expect(pageSource).toContain('metadataCache.current.load(deviceId, deviceGateway.show');
    expect(pageSource).toContain("async function reconcileWorkspace(");
    expect(pageSource).toContain("await reconcileWorkspace('activate', scope, 1)");
    expect(pageSource).toContain("await reconcileWorkspace('delete', scope, archivePage)");
    expect(pageSource).not.toContain("reconcileWorkspace('activate', scope, 1).then(() => activateDraft");
  });

  it('keeps workspace GET outages on the explicit retry path', () => {
    expect(pageSource).toContain("issueFor(error, 'read')");
    expect(pageSource).toContain('onRetry={pageState.issue.retryable ? () => void loadWorkspace() : undefined}');
  });
});
