"use client";

import { ClockCircleOutlined } from "@ant-design/icons";
import { Button, Card, Collapse, Empty, List, Popover, Space, Tag } from "antd";
import type { ScheduleDraftItem } from "@/lib/v5-ui-mock-data";
import { useMemo } from "react";

const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

function buildMonthCells(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();

  return Array.from({ length: 42 }, (_, index) => {
    const day = index - leadingDays + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
}

const scheduleStatusLabels: Record<ScheduleDraftItem["status"], string> = {
  unscheduled: "未排程",
  draft: "排程草稿",
  active: "正式排程",
  pending_config: "需人工发布"
};

const scheduleStatusColors: Record<ScheduleDraftItem["status"], string> = {
  unscheduled: "default",
  draft: "blue",
  active: "green",
  pending_config: "orange"
};

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function ScheduleDetails({ date, items }: { date: string; items: ScheduleDraftItem[] }) {
  if (!items.length) {
    return <Empty className="v5-calendar-popover-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="当天暂无排程" />;
  }

  return (
    <div className="v5-calendar-popover-content">
      <div className="v5-calendar-popover-heading">{date.slice(5)} · 共 {items.length} 篇</div>
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => (
          <List.Item>
            <List.Item.Meta
              avatar={<span className="v5-calendar-popover-time"><ClockCircleOutlined /> {item.time || "待定"}</span>}
              title={item.title}
              description={
                <Space size={4} wrap>
                  <span>{item.channel}</span>
                  <Tag color={scheduleStatusColors[item.status]}>{scheduleStatusLabels[item.status]}</Tag>
                  {item.platformAccount ? <span>{item.platformAccount}</span> : null}
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
}

export function ScheduleCalendarLite({ items, month = "2026-08" }: { items: ScheduleDraftItem[]; month?: string }) {
  const [year, monthNumber] = month.split("-").map(Number);
  const cells = buildMonthCells(year, monthNumber);
  const scheduledByDate = useMemo(() => {
    const result = new Map<string, ScheduleDraftItem[]>();

    for (const item of items) {
      if (!item.date) continue;
      const current = result.get(item.date) || [];
      result.set(item.date, [...current, item].sort((a, b) => (a.time || "").localeCompare(b.time || "")));
    }

    return result;
  }, [items]);
  const unscheduledItems = items.filter((item) => !item.date);

  return (
    <div className="v5-schedule-layout">
      <Card
        className="v5-schedule-calendar-card"
        title={`人工排程日历 · ${month}`}
        size="small"
        extra={<Tag>悬浮日期查看具体排程</Tag>}
      >
        <div className="v5-calendar-grid" role="grid" aria-label={`${month}人工排程日历`}>
          {weekDays.map((day) => <div className="v5-calendar-weekday" key={day}>{day}</div>)}
          {cells.map((day, index) => {
            if (!day) return <div className="v5-calendar-day is-empty" key={`empty-${index}`} />;

            const date = formatDate(year, monthNumber, day);
            const dayItems = scheduledByDate.get(date) || [];
            const draftCount = dayItems.filter((item) => item.status === "draft").length;
            const activeCount = dayItems.filter((item) => item.status === "active").length;
            const pendingCount = dayItems.filter((item) => item.status === "pending_config").length;

            return (
              <Popover
                key={date}
                overlayClassName="v5-calendar-popover"
                trigger={["hover", "click"]}
                placement="top"
                mouseEnterDelay={0.15}
                mouseLeaveDelay={0.1}
                content={<ScheduleDetails date={date} items={dayItems} />}
              >
                <button
                  className="v5-calendar-day"
                  type="button"
                  data-testid={`schedule-day-${date}`}
                  aria-label={`${date}，${dayItems.length}篇排程`}
                >
                  <div className="v5-calendar-date-row">
                    <span>{day}</span>
                    {dayItems.length ? <strong>{dayItems.length} 篇</strong> : null}
                  </div>
                  {dayItems.length ? (
                    <div className="v5-calendar-status-summary">
                      {activeCount ? <span><i className="is-active" /><b>{activeCount}</b><em>正式</em></span> : null}
                      {draftCount ? <span><i className="is-draft" /><b>{draftCount}</b><em>草稿</em></span> : null}
                      {pendingCount ? <span><i className="is-pending" /><b>{pendingCount}</b><em>人工发布</em></span> : null}
                    </div>
                  ) : (
                    <span className="v5-calendar-empty-label">暂无排程</span>
                  )}
                </button>
              </Popover>
            );
          })}
        </div>
        <div className="v5-calendar-legend">
          <Tag color="green">正式排程</Tag>
          <Tag color="blue">排程草稿</Tag>
          <Tag color="orange">需人工发布</Tag>
          <Tag>移动端点击日期查看详情</Tag>
        </div>
      </Card>

      <Collapse
        className="v5-unscheduled-collapse"
        items={[
          {
            key: "unscheduled",
            label: `未排程内容 · ${unscheduledItems.length} 篇`,
            children: (
              <List
                size="small"
                dataSource={unscheduledItems}
                locale={{ emptyText: "本月所有文章均已安排日期" }}
                renderItem={(item) => (
                  <List.Item actions={[<Button size="small" disabled key="schedule">安排日期</Button>]}>
                    <List.Item.Meta
                      title={item.title}
                      description={<Space size={4} wrap><span>{item.product}</span><span>·</span><span>{item.channel}</span></Space>}
                    />
                  </List.Item>
                )}
              />
            )
          }
        ]}
      />
      <div className="v5-inline-note">
        排程草稿可以提前占用日期；证据、规则和内容质量检查通过后，才能转为正式排程。
      </div>
    </div>
  );
}
