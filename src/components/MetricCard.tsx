import { Card, Statistic } from "antd";

interface MetricCardProps {
  title: string;
  value: string | number;
  suffix?: string;
}

export function MetricCard({ title, value, suffix }: MetricCardProps) {
  return (
    <Card size="small">
      <Statistic title={title} value={value} suffix={suffix} />
    </Card>
  );
}

