/**
 * T-066 설정 화면 회귀 — 안전장치 카드 맨 위 '● 집행 중' 띠와 카드 뒤 리스크 정책 요약 행만 더했고,
 * 기존 Promise.all 조회·handleSave 저장 대상·저장 바는 그대로임을 고정한다.
 * (SettingsPage 는 effect 로 조회하므로 정적 렌더는 '불러오는 중…'까지만 — 구조는 소스 순서로 본다.)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/settings' }));

import { SettingsPage } from '@/app/settings/SettingsPage';

const SRC = fs.readFileSync(path.resolve(__dirname, '../SettingsPage.tsx'), 'utf8');

test('정적 렌더가 깨지지 않는다 (첫 화면 = 불러오는 중)', () => {
  expect(renderToStaticMarkup(h(SettingsPage))).toContain('불러오는 중…');
});

test('집행 중 띠는 안전장치 카드 안 첫 줄(실거래 여부 앞)', () => {
  const header = SRC.indexOf('<SectionHeader title="안전장치 (공통)" />');
  const strip = SRC.indexOf('<EnforcedStrip />');
  const live = SRC.indexOf('실거래 여부 toggle');
  expect(header).toBeGreaterThan(0);
  expect(strip).toBeGreaterThan(header);
  expect(live).toBeGreaterThan(strip);
});

test('리스크 정책 요약 행은 안전장치 카드 뒤, 거래 보호 앞', () => {
  const daily = SRC.indexOf('일일 누적 최대');
  const row = SRC.indexOf('<RiskPolicySummaryRow />');
  const guard = SRC.indexOf('<SectionHeader title="거래 보호" />');
  expect(row).toBeGreaterThan(daily);
  expect(guard).toBeGreaterThan(row);
});

test('기존 조회·저장 흐름에 리스크 정책을 섞지 않았다', () => {
  const effect = SRC.slice(SRC.indexOf('Promise.all(['), SRC.indexOf(']).then(([safetyData'));
  expect(effect).not.toContain('risk');
  const save = SRC.slice(SRC.indexOf('const handleSave'), SRC.indexOf('if (loading) return'));
  expect(save).not.toMatch(/risk/i);
  expect(save).toContain("patchSetting('/api/settings/safety'");
  expect(SRC.match(/<RiskPolicySummaryRow \/>/g)).toHaveLength(1); // 요약 행은 한 곳에만
});
