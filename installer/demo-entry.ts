import { SimulatorService, scenarios, type Scenario } from './simulator';
import { mountInstaller } from './ui';
const root = document.querySelector<HTMLElement>('[data-demo-installer]');
const select = document.querySelector<HTMLSelectElement>('#scenario');
let service: SimulatorService;
if (root && select) {
  const original = root.innerHTML;
  const reset = async () => {
    await service?.close();
    // Replace the root to release the previous controller's DOM listeners.
    const next = root.cloneNode(false) as HTMLElement;
    next.innerHTML = original;
    document.querySelector('[data-demo-installer]')!.replaceWith(next);
    const value = scenarios.includes(select.value as Scenario)
      ? (select.value as Scenario)
      : 'success';
    service = new SimulatorService(value);
    mountInstaller(next, service);
  };
  select.addEventListener('change', () => {
    void reset();
  });
  void reset();
}
