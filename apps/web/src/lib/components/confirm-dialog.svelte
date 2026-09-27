<script lang="ts">
import { Button } from '$lib/components/ui/button/index.js';

interface Props {
  open?: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirming?: boolean;
  onConfirm?: () => void | Promise<void>;
}

let {
  open = $bindable(false),
  title = 'Are you sure?',
  description = 'This action cannot be undone.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  confirming = false,
  onConfirm,
}: Props = $props();

let dialogEl = $state<HTMLDialogElement | null>(null);

$effect(() => {
  const dialog = dialogEl;
  if (!dialog) return;

  if (open && !dialog.open) {
    dialog.showModal();
  } else if (!open && dialog.open) {
    dialog.close();
  }
});

function handleCancel() {
  if (confirming) return;
  open = false;
}

async function handleConfirm() {
  if (confirming) return;
  await onConfirm?.();
}
</script>

<dialog
  bind:this={dialogEl}
  class="fixed inset-0 z-50 m-auto w-[min(100%-2rem,24rem)] rounded-sm border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/50 open:flex open:flex-col"
  onclose={() => {
    open = false;
  }}
  onclick={(event) => {
    if (event.target === dialogEl) handleCancel();
  }}
>
  <div class="space-y-4 p-6">
    <div class="space-y-2">
      <h2 class="font-display font-semibold text-base tracking-tight">{title}</h2>
      <p class="text-[0.75rem] text-muted-foreground leading-relaxed">{description}</p>
    </div>

    <div class="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        class="rounded-sm border-border"
        disabled={confirming}
        onclick={handleCancel}
      >
        {cancelLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        class="rounded-sm border-destructive text-destructive hover:text-destructive"
        disabled={confirming}
        onclick={handleConfirm}
      >
        {confirming ? 'Deleting…' : confirmLabel}
      </Button>
    </div>
  </div>
</dialog>
