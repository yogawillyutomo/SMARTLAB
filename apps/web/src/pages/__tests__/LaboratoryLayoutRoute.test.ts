import { describe, expect, it } from 'vitest';
import appSource from '@/App.tsx?raw';
import pageSource from '@/pages/LaboratoryLayoutApiPage.tsx?raw';

describe('production canonical Laboratory Layout route boundary', () => {
  it('routes the canonical Laboratory ULID page behind exact layouts.view permission', () => {
    expect(appSource).toContain('path="/laboratories/:laboratoryId/layout"');
    expect(appSource).toContain('permission="layouts.view"><LaboratoryLayoutApiPage');
    expect(appSource).not.toContain('LaboratoryLayoutUnavailablePage');
    expect(pageSource).toContain('const { laboratoryId } = useParams()');
    expect(pageSource).toContain('loadLayoutWorkspaceData(laboratoryId');
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
});
