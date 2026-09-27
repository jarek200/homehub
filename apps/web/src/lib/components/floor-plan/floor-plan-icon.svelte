<script lang="ts">
type IconName =
  | 'edit'
  | 'select'
  | 'room'
  | 'pen'
  | 'door'
  | 'window'
  | 'flip'
  | 'flip-name'
  | 'close'
  | 'delete'
  | 'undo'
  | 'sample'
  | 'sample-a'
  | 'sample-b'
  | 'clear'
  | 'rotate';

interface Props {
  name: IconName;
}

let { name }: Props = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="size-4"
  aria-hidden="true"
>
  {#if name === 'edit'}
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  {:else if name === 'select'}
    <path d="M4 4l7.07 16.97 2.51-7.39 7.39-2.51L4 4z" />
    <path d="M13 13l6 6" />
  {:else if name === 'room'}
    <rect x="4" y="4" width="16" height="16" rx="1" />
  {:else if name === 'pen'}
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  {:else if name === 'close'}
    <polyline points="5 8 5 5 19 5 19 19 5 19 5 16" />
    <path d="M5 16c2-4 6-5 9-2" />
  {:else if name === 'door'}
    <path d="M5 21V5a2 2 0 0 1 2-2h7v18" />
    <path d="M5 21h14" />
    <path d="M14 3v18" />
    <path d="M11 12h.01" />
    <path d="M14 8c2.2 1.2 3.5 3.2 3.5 5.5S16.2 17.8 14 19" />
  {:else if name === 'window'}
    <rect x="3" y="5" width="18" height="14" />
    <path d="M12 5v14" />
    <path d="M3 12h18" />
  {:else if name === 'flip'}
    <path d="M7 7h8a3 3 0 0 1 3 3v2" />
    <path d="M10 4 7 7l3 3" />
    <path d="M17 17H9a3 3 0 0 1-3-3v-2" />
    <path d="M14 20 17 17l-3-3" />
  {:else if name === 'flip-name'}
    <path d="M8 17 12 6l4 11" />
    <path d="M9.4 13h5.2" />
    <path d="M17 5v4h4" />
    <path d="M21 5a8 8 0 1 0 1.2 6" />
  {:else if name === 'delete'}
    <path d="M4 7h16" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  {:else if name === 'undo'}
    <path d="M3 7v6h6" />
    <path d="M3 13a9 9 0 1 0 2.2-5.7L3 13" />
  {:else if name === 'sample' || name === 'sample-a' || name === 'sample-b'}
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <path d="M10 21v-6h4v6" />
  {:else if name === 'rotate'}
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  {:else}
    <path d="M4 6h16" />
    <path d="M4 12h10" />
    <path d="M4 18h16" />
    <path d="M18 9l3 3-3 3" />
  {/if}
</svg>
