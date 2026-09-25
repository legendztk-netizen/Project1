import { useState, type ComponentType, type ReactNode } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Form } from "react-router";
import { Plus, Trash2 } from "lucide-react";
import type { createChinaCalendarService } from "../application/china-calendar-service";
import "./shipment-documents.css";

export type ChinaCalendarDetails = Awaited<
  ReturnType<ReturnType<typeof createChinaCalendarService>["adminDetails"]>
>;
export type ChinaCalendarData = ChinaCalendarDetails & {
  saved: boolean;
  commandId: string;
};

type CalendarException = ChinaCalendarDetails["exceptions"][number];

type FormLike = ComponentType<{
  method: "post";
  className?: string;
  children: ReactNode;
}>;

const weekdays = [
  [1, "周一"],
  [2, "周二"],
  [3, "周三"],
  [4, "周四"],
  [5, "周五"],
  [6, "周六"],
  [7, "周日"],
] as const;

const errorMessages: Array<[RegExp, string]> = [
  [/coverage end precedes its start/, "覆盖结束日期不能早于覆盖起始日期。"],
  [/A valid calendar date is required/, "请填写有效的覆盖起始和结束日期。"],
  [/Confirm all China calendar exceptions/, "请勾选确认已核对全部例外日期。"],
  [/Select valid China calendar weekdays/, "请至少选择一个通常工作日。"],
  [/Calendar review reason is required/, "请填写本次日历审核依据。"],
  [
    /Invalid or duplicate China calendar exception/,
    "例外日期必须在覆盖区间内、不能重复，并填写原因。",
  ],
];

// Turns a calendar publish rejection into an actionable Admin message.
export function chinaCalendarError(status: number, message: string) {
  if (status === 409) return "日历版本已变化，请刷新后重新核对。";
  return (
    errorMessages.find(([pattern]) => pattern.test(message))?.[1] ??
    "日历发布失败，请检查覆盖日期、工作日、例外日期和审核依据。"
  );
}

function beijingToday() {
  return Temporal.Now.plainDateISO("Asia/Shanghai");
}

export function ChinaCalendarSummary({
  calendar,
  exceptionCount,
}: {
  calendar: ChinaCalendarDetails["calendar"];
  exceptionCount: number;
}) {
  if (!calendar)
    return (
      <p className="shipment-dialog-notice" role="status">
        尚未发布中国履约日历。按“订单确认后 N 个中国工作日”约定交期的订单，
        在发布日历前无法自动计算预计备妥日期。
      </p>
    );
  const daysLeft = beijingToday().until(
    Temporal.PlainDate.from(calendar.coverageThrough),
  ).days;
  return (
    <>
      <dl className="shipment-calendar-summary">
        <div>
          <dt>当前版本</dt>
          <dd>第 {calendar.version} 版</dd>
        </div>
        <div>
          <dt>覆盖区间</dt>
          <dd>
            {calendar.coverageFrom} 至 {calendar.coverageThrough}
          </dd>
        </div>
        <div>
          <dt>通常工作日</dt>
          <dd>
            {weekdays
              .filter(([day]) => calendar.workingWeekdays.includes(day))
              .map(([, label]) => label)
              .join("、")}
          </dd>
        </div>
        <div>
          <dt>例外日期</dt>
          <dd>{exceptionCount} 天</dd>
        </div>
      </dl>
      {daysLeft < 30 && (
        <p className="shipment-dialog-notice" role="status">
          {daysLeft < 0
            ? "日历覆盖已过期，新订单的预计备妥日期将无法自动计算。请发布新版本延长覆盖。"
            : `日历覆盖将在 ${daysLeft} 天后结束，请尽快发布新版本延长覆盖。`}
        </p>
      )}
    </>
  );
}

export function ChinaCalendarGuide() {
  return (
    <details className="shipment-calendar-guide">
      <summary>这个日历怎么用？</summary>
      <ul>
        <li>
          当订单交期约定为“订单确认后 N
          个中国工作日”时，系统从确认日的第二天起，
          按本日历逐日数工作日，算出预计备妥日期。
        </li>
        <li>
          <strong>覆盖起始日期</strong>
          ：从哪天起的放假安排已经核实。通常填今天， 或本年 1 月 1 日。
        </li>
        <li>
          <strong>覆盖结束日期</strong>：核实到哪天为止。建议填到本年 12 月 31
          日； 每年国务院公布下一年放假安排后，再发布新版本延长到下一年年底。
          如果某订单的“确认日 + 交期”超出覆盖区间，该订单日期会显示为待落实，
          延长覆盖后在批次卡片上点“按已发布日历落实约定日期”即可。
        </li>
        <li>
          <strong>通常工作日</strong>：工厂平时上班的星期几，一般是周一至周五；
          周六也上班就勾上周六。
        </li>
        <li>
          <strong>例外日期</strong>：法定节假日、工厂停工填“不工作”；
          调休补班的周末填“工作”。只需填与“通常工作日”不同的日子。
        </li>
        <li>
          每次发布生成一个不可修改的新版本。已经算好的订单日期不会因新版本而改变。
        </li>
      </ul>
    </details>
  );
}

export function ChinaCalendarForm({
  calendar,
  exceptions: initialExceptions,
  commandId,
  error,
  busy,
  FormComponent = Form as FormLike,
  hiddenFields,
}: {
  calendar: ChinaCalendarDetails["calendar"];
  exceptions: CalendarException[];
  commandId: string;
  error?: string;
  busy: boolean;
  FormComponent?: FormLike;
  hiddenFields?: ReactNode;
}) {
  const [exceptions, setExceptions] = useState(initialExceptions);
  const today = beijingToday();
  const update = (index: number, patch: Partial<CalendarException>) =>
    setExceptions((items) =>
      items.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  return (
    <FormComponent method="post" className="shipment-calendar-form">
      {hiddenFields}
      <input
        type="hidden"
        name="expectedCurrentVersion"
        value={calendar?.version ?? ""}
      />
      <input type="hidden" name="commandId" value={commandId} />
      <div className="shipment-calendar-grid">
        <label>
          覆盖起始日期
          <input
            type="date"
            name="coverageFrom"
            defaultValue={calendar?.coverageFrom ?? today.toString()}
            required
          />
          <small>从哪天起的放假安排已核实，通常填今天。</small>
        </label>
        <label>
          覆盖结束日期
          <input
            type="date"
            name="coverageThrough"
            defaultValue={
              calendar?.coverageThrough ??
              today.with({ month: 12, day: 31 }).toString()
            }
            required
          />
          <small>核实到哪天为止，建议填到年底。</small>
        </label>
      </div>
      <fieldset>
        <legend>通常工作日</legend>
        <div className="shipment-calendar-weekdays">
          {weekdays.map(([day, label]) => (
            <label key={day}>
              <input
                type="checkbox"
                name="workingWeekday"
                value={day}
                defaultChecked={
                  calendar ? calendar.workingWeekdays.includes(day) : day <= 5
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>例外日期：节假日、停工与调休补班</legend>
        {exceptions.length === 0 && (
          <p className="shipment-form-note">
            尚无例外日期。例如国庆假期填“不工作”，调休补班的周日填“工作”。
          </p>
        )}
        <div className="shipment-calendar-exceptions">
          {exceptions.map((exception, index) => (
            <div className="shipment-calendar-exception" key={index}>
              <label>
                日期
                <input
                  type="date"
                  name="exceptionDate"
                  value={exception.date}
                  onChange={(event) =>
                    update(index, { date: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                当天是否工作
                <select
                  name="exceptionIsWorking"
                  value={String(exception.isWorking)}
                  onChange={(event) =>
                    update(index, { isWorking: event.target.value === "true" })
                  }
                >
                  <option value="false">不工作</option>
                  <option value="true">工作</option>
                </select>
              </label>
              <label>
                原因
                <input
                  name="exceptionReason"
                  value={exception.reason}
                  onChange={(event) =>
                    update(index, { reason: event.target.value })
                  }
                  maxLength={500}
                  placeholder="例如：国庆节"
                  required
                />
              </label>
              <button
                type="button"
                className="button button-secondary"
                aria-label={`删除第 ${index + 1} 个例外日期`}
                onClick={() =>
                  setExceptions((items) =>
                    items.filter((_, position) => position !== index),
                  )
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() =>
            setExceptions((items) => [
              ...items,
              { date: "", isWorking: false, reason: "" },
            ])
          }
        >
          <Plus size={16} aria-hidden="true" /> 添加例外日期
        </button>
      </fieldset>
      <label>
        本次日历审核依据
        <textarea
          name="revisionReason"
          maxLength={2000}
          placeholder="例如：已按国务院 2026 年放假安排核对，并确认工厂春节停工日期。"
          required
        />
      </label>
      <label className="shipment-calendar-confirm">
        <input type="checkbox" name="confirmedComplete" required />
        已核对覆盖区间内所有节假日、停工和调休；发布后该版本不可修改。
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>
        {busy ? "正在发布…" : "发布中国履约日历"}
      </button>
    </FormComponent>
  );
}
