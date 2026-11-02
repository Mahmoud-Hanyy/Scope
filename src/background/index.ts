import { registerMessageRouter } from './message-router';
import { registerSessionLifecycle } from './session-manager';
import { registerEventIngestion } from './event-ingestion';

registerMessageRouter();
registerSessionLifecycle();
registerEventIngestion();

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  // Invoke open synchronously while Chrome's toolbar user gesture is active.
  void chrome.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => {
    console.error('[Scope] Could not open the Side Panel.', error);
  });
});

async function configureSidePanel(): Promise<void> {
  try {
    // Route the action through onClicked so it also grants activeTab access.
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (error) {
    console.error('[Scope] Could not configure the Side Panel.', error);
  }
}

// Reapply on worker startup, including upgrades from automatic panel opening.
void configureSidePanel();
