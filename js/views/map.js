// View placeholder — replaced in next step.
import { el } from '../widgets.js';
export const view = {
  id: 'map', num: 5, title: 'Map',
  render(root){ root.appendChild(el('div.view-head',{},[el('h2',{text:'Map — building…'})])); },
};
