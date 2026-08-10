'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { ScenarioBuilder, type BuilderValues } from '@/components/ScenarioBuilder';
import { ScenarioAnalysis } from '@/components/ScenarioAnalysis';
import type { ScenarioCard, ScenarioGrade } from '@/lib/signals/scenario-builder';

// ScenarioAnalysis.tsx의 (미export) AnalysisResult와 동일한 형태 — 구조적 타이핑으로 호환.
interface AnalysisResult {
  market?: 'domestic' | 'overseas';
  grade: ScenarioGrade;
  ev: number;
  pWin: number;
  rr: number;
  buyRationale: string[];
  risks: string[];
  aiSuggestedScenario: ScenarioCard;
  currentPrice?: number;
  priceUnit?: string;
}

type Step = 'build' | 'analysis';

export default function RecommendBuildPage() {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<Step>('build');
  const [values, setValues] = useState<BuilderValues | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleAnalyze(v: BuilderValues) {
    setAnalyzing(true);
    try {
      const res = await fetch('/api/signals/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: v.market,
          symbol: v.symbol,
          direction: v.direction,
          currentPrice: v.currentPrice,
          splits: v.splits,
          holdingDeadline: v.holdingDeadline,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setValues(v);
        setResult({
          market: data.market,
          grade: data.grade,
          ev: data.ev,
          pWin: data.pWin,
          rr: data.rr,
          buyRationale: data.buyRationale,
          risks: data.risks,
          aiSuggestedScenario: data.aiSuggestedScenario,
          currentPrice: data.currentPrice,
          priceUnit: data.priceUnit,
        });
        setStep('analysis');
      } else {
        toast.show(`분석 실패: ${data.error ?? '알 수 없는 오류'}`, 'error');
      }
    } catch (e) {
      toast.show(`분석 실패: ${String(e)}`, 'error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleConfirm(scenario: ScenarioCard) {
    if (!values) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/signals/custom/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: values.market,
          symbol: values.symbol,
          direction: values.direction,
          scenario,
          currentPrice: result?.currentPrice ?? values.currentPrice ?? 0,
          manualSlices: values.manualSlices
            .filter(s => Number(s.qty) > 0)
            .map(s => ({ zoneLo: Number(s.zoneLo), zoneHi: Number(s.zoneHi), qty: Number(s.qty) })),
          splits: values.splits,
          // sourceSignalId 없음 — AI 추천 승인 경로가 아니라 사용자 직접 작성 경로
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.show('시나리오가 등록됐습니다', 'success');
        setTimeout(() => router.push('/recommend'), 1200);
      } else {
        toast.show(`등록 실패: ${data.error ?? '알 수 없는 오류'}`, 'error');
      }
    } catch (e) {
      toast.show(`등록 실패: ${String(e)}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleEdit() {
    setStep('build');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 40 }}>
      {/* 헤더 */}
      <div style={{
        padding: '12px 16px 10px', position: 'sticky', top: 0,
        background: 'var(--bg)', zIndex: 10, borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button onClick={() => router.back()} style={{ fontSize: 20, color: 'var(--muted)', lineHeight: 1 }} aria-label="뒤로가기">←</button>
        <div style={{ flex: 1, fontSize: 17, fontWeight: 700 }}>
          내 시나리오 만들기{step === 'analysis' ? ' · 분석 결과' : ''}
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {step === 'build' && (
          <ScenarioBuilder
            initialValues={values ?? undefined}
            onAnalyze={handleAnalyze}
            loading={analyzing}
          />
        )}
        {step === 'analysis' && values && result && (
          <ScenarioAnalysis
            values={values}
            result={result}
            onConfirm={handleConfirm}
            onEdit={handleEdit}
            submitting={submitting}
          />
        )}
      </div>
    </div>
  );
}
