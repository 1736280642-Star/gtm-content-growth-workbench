import { Button, Card, List, Space, Tag } from "antd";
import type { ScheduleDraftItem } from "@/lib/v5-ui-mock-data";

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
  pending_config: "发布待配置"
};

export function ScheduleCalendarLite({ items, month = "2026-08" }: { items: ScheduleDraftItem[]; month?: string }) {
  const [year, monthNumber] = month.split("-").map(Number);
  const cells = buildMonthCells(year, monthNumber);
  const unscheduledItems = items.filter((item) => !item.date);

  function countForDay(day: number) {
    const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return items.filter((item) => item.date === date).length;
  }

  return (
    <div className="v5-schedule-layout">
      <Card
        title={`人工排程日历 · ${month}`}
        size="small"
        extra={<Tag>同日、同账号、同时间不做容量限制</Tag>}
      >
        <div className="v5-calendar-grid" role="grid" aria-label={`${month}人工排程日历`}>
          {weekDays.map((day) => <div className="v5-calendar-weekday" key={day}>{day}</div>)}
          {cells.map((day, index) => {
            const count = day ? countForDay(day) : 0;
            return (
              <button className={`v5-calendar-day${day ? "" : " is-empty"}`} type="button" key={`${day || "empty"}-${index}`} disabled={!day}>
                {day ? <span>{day}</span> : null}
                {count ? <strong>{count} 篇</strong> : null}
              </button>
            );
          })}
        </div>
        <div className="v5-calendar-legend">
          <Tag color="blue">排程草稿：可提前占日期</Tag>
          <Tag color="green">正式排程：质检通过且已人工确认</Tag>
          <Tag>mock：点击日期暂不写入后端</Tag>
        </div>
      </Card>

      <Card title={`未排程列表 · ${unscheduledItems.length}`} size="small">
        <List
          size="small"
          dataSource={unscheduledItems}
          locale={{ emptyText: "本月所有文章均已安排日期" }}
          renderItem={(item) => (
            <List.Item actions={[<Button size="small" disabled key="schedule">选择日期</Button>]}>
              <List.Item.Meta
                title={item.title}
                description={
                  <Space size={4} wrap>
                    <span>{item.product}</span>
                    <span>·</span>
                    <span>{item.channel}</span>
                    <Tag>{scheduleStatusLabels[item.status]}</Tag>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
        <AlertLikeScheduleNote />
      </Card>
    </div>
  );
}

function AlertLikeScheduleNote() {
  return (
    <div className="v5-inline-note">
      排程草稿不等于正式发布任务。只有 Final Evidence Gate、硬规则和软质量通过后，才可激活为正式 Publish Schedule。
    </div>
  );
}
