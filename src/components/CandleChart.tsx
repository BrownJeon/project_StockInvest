'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@/lib/exchanges/types';

interface Props {
  data: Candle[];
  height?: number;
}

export function CandleChart({ data, height = 320 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: { background: { color: '#0f1115' }, textColor: '#e6e8ee' },
      grid: { vertLines: { color: '#1a1f2b' }, horzLines: { color: '#1a1f2b' } },
      rightPriceScale: { borderColor: '#262b36' },
      timeScale: { borderColor: '#262b36', timeVisible: true },
      crosshair: { mode: 1 },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false } },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#ef4444', downColor: '#3b82f6',
      borderUpColor: '#ef4444', borderDownColor: '#3b82f6',
      wickUpColor: '#ef4444', wickDownColor: '#3b82f6',
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (ref.current) {
        chart.applyOptions({ width: ref.current.clientWidth, height: ref.current.clientHeight });
      }
    });
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    const mapped = data
      .map((c) => ({
        time: Math.floor(c.ts / 1000) as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    seriesRef.current.setData(mapped);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
