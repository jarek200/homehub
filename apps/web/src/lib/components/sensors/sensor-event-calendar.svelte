<script lang="ts">
import {
  eventsOnLocalDay,
  filledHoursByLocalDay,
  isCurrentLocalMonth,
  isLoggedSensorValue,
  localDayKey,
  localMonthCells,
  localMonthLabel,
  localMonthRange,
  mergeSensorEvents,
  type SensorEvent,
  type SensorHistoryEvent,
  type SensorHistoryKind,
  sensorEventLabel,
  sensorHistoryClock,
  shiftLocalMonth,
  WEEKDAY_LETTERS,
} from '@homehub/core';
import { listSensorEvents } from '$lib/services/rest-api';

interface Props {
  deviceId: string;
  kind: SensorHistoryKind;
  hubEvents?: SensorHistoryEvent[];
  accordion?: boolean;
}

let { deviceId, kind, hubEvents = [], accordion = false }: Props = $props();

const started = new Date();
const emptyHours = Array.from({ length: 24 }, () => false);
let year = $state(started.getFullYear());
let monthIndex = $state(started.getMonth());
let selectedKey = $state(localDayKey(started));
let apiEvents = $state.raw<SensorEvent[]>([]);
let loading = $state(false);

const cells = $derived(localMonthCells(year, monthIndex));
const label = $derived(localMonthLabel(year, monthIndex));
const atCurrentMonth = $derived(isCurrentLocalMonth(year, monthIndex));
const monthEvents = $derived(
  mergeSensorEvents(
    apiEvents.map((event) => ({ kind: event.kind, at: event.at, value: event.value })),
    hubEvents.filter((event) => isLoggedSensorValue(kind, event.value))
  )
);
const hoursByDay = $derived(filledHoursByLocalDay(monthEvents));
const dayEvents = $derived(eventsOnLocalDay(monthEvents, selectedKey));
const selectedLabel = $derived(
  selectedKey
    ? new Date(`${selectedKey}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : ''
);
const emptyCopy = $derived(
  kind === 'contact'
    ? 'No open events.'
    : kind === 'motion'
      ? 'No detected events.'
      : 'No leak events.'
);

$effect(() => {
  const id = deviceId;
  const nextKind = kind;
  if (nextKind === 'leak') {
    apiEvents = [];
    loading = false;
    return;
  }
  const range = localMonthRange(year, monthIndex);
  let cancelled = false;
  loading = true;
  void listSensorEvents({
    from: range.from,
    to: range.to,
    deviceId: id,
    kind: nextKind,
    limit: 2000,
  })
    .then((events) => {
      if (!cancelled) apiEvents = events;
    })
    .catch(() => {
      if (!cancelled) apiEvents = [];
    })
    .finally(() => {
      if (!cancelled) loading = false;
    });
  return () => {
    cancelled = true;
  };
});

function go(delta: number) {
  if (delta > 0 && atCurrentMonth) return;
  const next = shiftLocalMonth(year, monthIndex, delta);
  year = next.year;
  monthIndex = next.monthIndex;
  selectedKey = isCurrentLocalMonth(next.year, next.monthIndex)
    ? localDayKey()
    : `${next.year}-${String(next.monthIndex + 1).padStart(2, '0')}-01`;
}
</script>

{#snippet month()}
  <div class="cal-month">
    <div class="cal-head">
      <h2>{label}</h2>
      <div class="cal-nav">
        <button type="button" aria-label="Previous month" onclick={() => go(-1)}>‹</button>
        <button
          type="button"
          aria-label="Next month"
          disabled={atCurrentMonth}
          onclick={() => go(1)}
        >
          ›
        </button>
      </div>
    </div>
    <div class="cal-grid">
      {#each WEEKDAY_LETTERS as letter, index (`wd-${index}`)}
        <span class="cal-wd" aria-hidden="true">{letter}</span>
      {/each}
      {#each cells as cell (cell.key)}
        {#if cell.dayKey && cell.day}
          {@const hours = hoursByDay[cell.dayKey] ?? emptyHours}
          {@const on = hours.some(Boolean)}
          {@const selected = selectedKey === cell.dayKey}
          <button
            type="button"
            class={['cal-day', selected && 'selected']}
            aria-pressed={selected}
            aria-label="{cell.day} {label}{on ? ', has events' : ''}"
            onclick={() => {
              selectedKey = cell.dayKey ?? selectedKey;
            }}
          >
            <span class="cal-num">{cell.day}</span>
            <span class="day-dots" aria-hidden="true">
              {#each hours as lit, hour (hour)}
                <i class={lit ? 'on' : undefined}></i>
              {/each}
            </span>
          </button>
        {:else}
          <span class="cal-pad"></span>
        {/if}
      {/each}
    </div>
  </div>
{/snippet}

{#snippet dayList()}
  <div class="cal-day-list">
    <p class="cal-day-label">{selectedLabel}</p>
    {#if loading && !dayEvents.length}
      <p class="cal-empty">Loading…</p>
    {:else if dayEvents.length}
      <ul>
        {#each dayEvents as event (event.at + event.value)}
          <li>
            <time datetime={event.at}>{sensorHistoryClock(event.at)}</time>
            <span aria-hidden="true"> · </span>
            {sensorEventLabel(event.value)}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="cal-empty">{emptyCopy}</p>
    {/if}
  </div>
{/snippet}

<section aria-label="Event calendar">
  <div class={['cal-body', accordion && 'folded']}>
    {#if accordion}
      <details class="cal-fold">
        <summary>Calendar</summary>
        {@render month()}
      </details>
    {:else}
      {@render month()}
    {/if}
    {@render dayList()}
  </div>
</section>

<style>
  section {
    width: 100%;
  }

  .cal-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 0.85rem;
  }

  .cal-fold {
    max-width: 24rem;
  }

  .cal-fold summary {
    cursor: pointer;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .cal-fold[open] summary {
    margin-bottom: 0.5rem;
  }

  .cal-month {
    max-width: 24rem;
  }

  .cal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  h2 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  .cal-nav {
    display: flex;
    gap: 0.25rem;
  }

  .cal-nav button {
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid currentcolor;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: 1;
    cursor: pointer;
  }

  .cal-nav button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0.2rem;
    margin-top: 0.85rem;
  }

  .cal-wd,
  .cal-pad {
    display: block;
    min-height: 1.4rem;
  }

  .cal-wd {
    color: var(--muted-foreground);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    line-height: 1.4rem;
    text-align: center;
  }

  .cal-day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.22rem;
    min-height: 2.85rem;
    border: 0;
    background: transparent;
    padding: 0.2rem 0 0.28rem;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .cal-num {
    line-height: 1;
  }

  .day-dots {
    display: grid;
    grid-template-columns: repeat(6, 3px);
    grid-template-rows: repeat(4, 3px);
    gap: 1px;
    justify-content: center;
  }

  .day-dots i {
    display: block;
    width: 3px;
    height: 3px;
    background: color-mix(in srgb, currentcolor 22%, transparent);
  }

  .day-dots i.on {
    background: currentcolor;
  }

  .cal-day.selected {
    background: #f5f5f5;
    color: #111;
  }

  .cal-day-list {
    min-width: 0;
  }

  @media (min-width: 720px) {
    .cal-body:not(.folded) {
      flex-direction: row;
      align-items: flex-start;
      gap: 2.25rem;
    }

    .cal-body:not(.folded) .cal-month {
      flex: 0 0 24rem;
    }

    .cal-body:not(.folded) .cal-day-list {
      flex: 1 1 14rem;
      max-width: 22rem;
    }
  }

  .cal-day-label {
    margin: 0;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }

  ul {
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    padding: 0.28rem 0;
    border-bottom: 1px solid currentcolor;
    font-size: 0.85rem;
  }

  time {
    font-variant-numeric: tabular-nums;
  }

  .cal-empty {
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
</style>
