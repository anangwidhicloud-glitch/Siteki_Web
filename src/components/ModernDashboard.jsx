/**
 * Modern Dashboard Components
 * Professional UI with animations and modern charts
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Activity, AlertTriangle, ArrowUpRight, BarChart3,
  CalendarDays, CheckCircle2, ChevronRight, Clock,
  Database, Download, Droplets, FileBarChart,
  Gauge, Globe, HardHat, LayoutDashboard,
  Package, Settings, TimerReset, TrendingDown,
  TrendingUp, Wrench, Zap
} from 'lucide-react';

/* ============================================
   ANIMATED COUNTER
   ============================================ */
export function AnimatedCounter({ value, duration = 1000, decimals = 0 }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const start = 0;
    const end = parseFloat(value) || 0;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * easeOut;
      setDisplay(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration]);

  return (
    <span className="animated-counter">
      {decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString('id-ID')}
    </span>
  );
}

/* ============================================
   MODERN STAT CARD
   ============================================ */
export function ModernStatCard({
  icon: Icon,
  label,
  value,
  trend,
  trendValue,
  color = 'mint',
  delay = 0
}) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), delay);
        }
      },
      { threshold: 0.1 }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [delay]);

  const isPositive = trend === 'up';
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  return (
    <div
      ref={cardRef}
      className={`modern-stat-card ${isVisible ? 'visible' : ''}`}
      style={{ '--accent-color': `var(--accent-${color})` }}
    >
      <div className="stat-icon">
        <Icon size={24} />
      </div>
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        <span className="stat-value">
          <AnimatedCounter value={value} />
        </span>
        {trend && (
          <span className={`stat-trend ${isPositive ? 'positive' : 'negative'}`}>
            <TrendIcon size={14} />
            <span>{trendValue}%</span>
            <span className="trend-period">vs last month</span>
          </span>
        )}
      </div>
      <div className="stat-glow" />
    </div>
  );
}

/* ============================================
   CIRCULAR PROGRESS
   ============================================ */
export function CircularProgress({
  value,
  size = 120,
  strokeWidth = 8,
  color = 'var(--primary)',
  showValue = true,
  label
}) {
  const [animatedValue, setAnimatedValue] = useState(0);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (animatedValue / 100) * circumference;

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedValue(Math.min(value, 100));
    }, 100);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <div className="circular-progress" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          className="progress-bg"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className="progress-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ stroke: color }}
        />
      </svg>
      {showValue && (
        <div className="progress-content">
          <span className="progress-value">{Math.round(animatedValue)}%</span>
          {label && <span className="progress-label">{label}</span>}
        </div>
      )}
    </div>
  );
}

/* ============================================
   MODERN LINE CHART
   ============================================ */
export function ModernLineChart({
  data = [],
  width = 600,
  height = 250,
  color = 'var(--primary)',
  showGrid = true,
  showDots = true,
  showArea = true,
  animate = true
}) {
  const [progress, setProgress] = useState(animate ? 0 : 1);

  useEffect(() => {
    if (animate) {
      const timer = setTimeout(() => setProgress(1), 100);
      return () => clearTimeout(timer);
    }
  }, [animate]);

  if (!data.length) return null;

  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(...data.map(d => d.value || 0), 1);
  const minValue = Math.min(...data.map(d => d.value || 0), 0);
  const range = maxValue - minValue || 1;

  const xScale = (index) => padding.left + (index / (data.length - 1 || 1)) * chartWidth;
  const yScale = (value) => padding.top + chartHeight - ((value - minValue) / range) * chartHeight;

  const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ');
  const areaPath = data.length > 0
    ? `M ${xScale(0)},${yScale(data[0].value)} L ${data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' L ')} L ${xScale(data.length - 1)},${padding.top + chartHeight} L ${xScale(0)},${padding.top + chartHeight} Z`
    : '';

  return (
    <div className="modern-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        {showGrid && [0, 0.25, 0.5, 0.75, 1].map((tick, i) => (
          <line
            key={i}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + chartHeight * (1 - tick)}
            y2={padding.top + chartHeight * (1 - tick)}
            stroke="var(--border)"
            strokeDasharray="4 4"
          />
        ))}

        {/* Area */}
        {showArea && (
          <path
            d={areaPath}
            fill={color}
            fillOpacity={0.1}
            style={{
              transition: `all ${600}ms ease-out`,
              clipPath: `inset(0 ${100 - progress * 100}% 0 0)`
            }}
          />
        )}

        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transition: `all ${600}ms ease-out`,
            clipPath: `inset(0 ${100 - progress * 100}% 0 0)`
          }}
        />

        {/* Dots */}
        {showDots && data.map((d, i) => (
          <circle
            key={i}
            cx={xScale(i)}
            cy={yScale(d.value)}
            r="5"
            fill="var(--bg-dark)"
            stroke={color}
            strokeWidth="2"
            style={{
              opacity: progress,
              transition: `opacity ${300}ms ease-out ${i * 50}ms`
            }}
          />
        ))}

        {/* Labels */}
        {data.map((d, i) => (
          <text
            key={i}
            x={xScale(i)}
            y={height - 5}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="10"
          >
            {d.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ============================================
   MODERN BAR CHART
   ============================================ */
export function ModernBarChart({
  data = [],
  color = 'var(--primary)',
  maxValue
}) {
  const [animated, setAnimated] = useState(false);
  const chartRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setAnimated(true);
        }
      },
      { threshold: 0.2 }
    );

    if (chartRef.current) {
      observer.observe(chartRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const max = maxValue || Math.max(...data.map(d => d.value || 0), 1);

  return (
    <div ref={chartRef} className="modern-bar-chart">
      {data.map((item, index) => (
        <div key={index} className="bar-item">
          <div className="bar-label">{item.label}</div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: animated ? `${(item.value / max) * 100}%` : '0%',
                background: color,
                transitionDelay: `${index * 100}ms`
              }}
            />
          </div>
          <div className="bar-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ============================================
   DONUT CHART
   ============================================ */
export function DonutChart({
  data = [],
  size = 200,
  thickness = 24
}) {
  const [animated, setAnimated] = useState(false);
  const chartRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setAnimated(true);
        }
      },
      { threshold: 0.2 }
    );

    if (chartRef.current) {
      observer.observe(chartRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const radius = (size - thickness) / 2;
  const circumference = radius * 2 * Math.PI;
  let offset = 0;

  return (
    <div ref={chartRef} className="donut-chart" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          className="donut-bg"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
        />
        {data.map((item, index) => {
          const strokeDasharray = `${(item.value / 100) * circumference} ${circumference}`;
          const strokeDashoffset = -offset;
          offset += (item.value / 100) * circumference;

          return (
            <circle
              key={index}
              className="donut-segment"
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={thickness}
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              stroke={item.color || 'var(--primary)'}
              style={{
                transition: `stroke-dasharray ${600}ms ease-out ${index * 100}ms, opacity ${400}ms ease-out`,
                opacity: animated ? 1 : 0
              }}
            />
          );
        })}
      </svg>
      <div className="donut-center">
        {data[0] && <span>{data[0].value}%</span>}
      </div>
    </div>
  );
}

/* ============================================
   SKELETON LOADER
   ============================================ */
export function Skeleton({ width = '100%', height = 20, borderRadius = 8 }) {
  return (
    <div
      className="skeleton-loader"
      style={{ width, height, borderRadius }}
    />
  );
}

/* ============================================
   KPI CARD WITH CHART
   ============================================ */
export function KpiCardWithChart({
  title,
  value,
  unit = '',
  data = [],
  color = 'var(--primary)',
  trend,
  trendValue,
  icon: Icon
}) {
  return (
    <div className="kpi-card-with-chart">
      <div className="kpi-header">
        {Icon && (
          <div className="kpi-icon" style={{ background: `${color}20`, color }}>
            <Icon size={20} />
          </div>
        )}
        <div className="kpi-info">
          <span className="kpi-title">{title}</span>
          <span className="kpi-value">
            <AnimatedCounter value={value} />
            {unit && <span className="kpi-unit">{unit}</span>}
          </span>
        </div>
        {trend && (
          <div className={`kpi-trend ${trend}`}>
            {trend === 'up' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
            <span>{trendValue}%</span>
          </div>
        )}
      </div>
      <div className="kpi-chart">
        <ModernLineChart data={data} color={color} height={60} showDots={false} showGrid={false} />
      </div>
    </div>
  );
}

/* ============================================
   EXPORT ALL
   ============================================ */
export default {
  AnimatedCounter,
  ModernStatCard,
  CircularProgress,
  ModernLineChart,
  ModernBarChart,
  DonutChart,
  Skeleton,
  KpiCardWithChart
};
