import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const demoPath = path.resolve(import.meta.dirname, '../pages/demo.astro');
const workspacePagePath = path.resolve(import.meta.dirname, '../components/WorkspacePage.astro');
const stylesPath = path.resolve(import.meta.dirname, '../styles/global.css');
const demo = fs.readFileSync(demoPath, 'utf8');
const workspacePage = fs.readFileSync(workspacePagePath, 'utf8');
const styles = fs.readFileSync(stylesPath, 'utf8');

describe('demo shell', () => {
  it('uses a viewport-bound workspace and keeps scroll inside practice content', () => {
    expect(demo).toContain('WorkspacePage');
    expect(workspacePage).toContain('<body class="demo-page">');
    expect(styles).toContain('.demo-page { height: 100dvh; overflow: hidden; }');
    expect(styles).toContain('.workspace-page { height: 100dvh; overflow: hidden; padding: 0; }');
    expect(styles).toContain('.practice-content { min-height: 0; overflow: auto;');
  });
});
