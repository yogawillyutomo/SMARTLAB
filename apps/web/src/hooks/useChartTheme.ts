import { useUIStore } from '@/stores/uiStore';

export interface ChartTheme {
  grid: string;
  axis: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  orange: string;
  tooltip: {
    backgroundColor: string;
    border: string;
    borderRadius: number;
    color: string;
    fontSize: number;
  };
  legend: {
    color: string;
    fontSize: number;
  };
}

export function useChartTheme(): ChartTheme {
  useUIStore((state) => state.resolvedTheme);
  return {
    grid: 'rgb(var(--color-chart-grid))',
    axis: 'rgb(var(--color-chart-axis))',
    primary: 'rgb(var(--color-accent-primary))',
    secondary: 'rgb(var(--color-accent-secondary))',
    success: 'rgb(var(--color-success))',
    warning: 'rgb(var(--color-warning))',
    danger: 'rgb(var(--color-danger))',
    orange: 'rgb(var(--color-orange))',
    tooltip: {
      backgroundColor: 'rgb(var(--color-chart-tooltip-bg))',
      border: '1px solid rgb(var(--color-chart-tooltip-border))',
      borderRadius: 8,
      color: 'rgb(var(--color-chart-tooltip-text))',
      fontSize: 12,
    },
    legend: {
      color: 'rgb(var(--color-chart-axis))',
      fontSize: 11,
    },
  };
}
