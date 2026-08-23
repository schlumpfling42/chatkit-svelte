<script lang="ts">
  import { getChatContext } from '../src/context';

  const store = getChatContext();
</script>

<p data-testid="run-status">{store.runStatus}</p>
<p data-testid="message-count">{store.messages.length}</p>
