<script lang="ts">
  type Props = {
    checked?: boolean;
    disabled?: boolean;
    id?: string;
    label?: string;
    class?: string;
    onchange?: (checked: boolean) => void;
  };

  let { checked = $bindable(false), disabled = false, id, label, class: className = "", onchange }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button {id} type="button" role="switch" aria-checked={checked} aria-label={label} class="ui-switch {className}" {disabled} onclick={toggle}>
  <i class="ui-switch-knob" aria-hidden="true"></i>
</button>
