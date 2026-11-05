import { Button, Container, Label, SliderInput } from '@playcanvas/pcui';

import { Events } from '../events';
import { Splat } from '../splat';
import { i18n } from './localization';

class ViewDependentControls extends Container {
    constructor(events: Events) {
        super({ id: 'view-dependent-controls', hidden: true });

        const header = new Container({ class: 'panel-header' });
        const title = new Label({ class: 'panel-header-label' });
        i18n.bindText(title, 'panel.view-dependent');
        header.append(title);
        this.append(header);

        const slider = (key: string, id: string, max: number, value: number) => {
            const row = new Container({ class: 'view-dependent-row' });
            const label = new Label({ class: 'view-dependent-label' });
            i18n.bindText(label, key);
            const input = new SliderInput({
                id,
                min: 0,
                max,
                step: 0.01,
                precision: 2,
                value,
                class: 'view-dependent-slider'
            });
            row.append(label);
            row.append(input);
            this.append(row);
            return input;
        };
        const uncertainty = slider('panel.view-dependent.max-uncertainty', 'max-view-uncertainty', 1, 1);
        const evidence = slider('panel.view-dependent.min-evidence', 'min-view-evidence', 1, 0);
        evidence.max = undefined;
        const note = new Label({ class: 'view-dependent-note' });
        this.append(note);
        const reset = new Button({ class: 'view-dependent-reset' });
        i18n.bindText(reset, 'panel.view-dependent.reset');
        this.append(reset);

        let selected: Splat = null;
        let updating = false;
        const update = () => {
            updating = true;
            this.hidden = !selected;
            const data = selected?.viewDependent;
            uncertainty.enabled = (data?.uncertaintyLayer ?? -1) >= 0;
            evidence.enabled = (data?.evidenceLayer ?? -1) >= 0;
            // The slider spans a conservative directional upper bound. Numeric
            // entry may exceed it, allowing an explicit hide-all threshold.
            evidence.sliderMax = Math.max(data?.evidenceMax ?? 1, selected?.minViewEvidence ?? 0);
            uncertainty.value = selected?.maxViewUncertainty ?? 1;
            evidence.value = selected?.minViewEvidence ?? 0;
            reset.enabled = uncertainty.enabled || evidence.enabled;
            note.text = i18n.t(reset.enabled ? 'panel.view-dependent.note' : 'panel.view-dependent.missing');
            updating = false;
        };

        uncertainty.on('change', (value: number) => {
            if (!updating && selected) selected.maxViewUncertainty = value;
        });
        evidence.on('change', (value: number) => {
            if (!updating && selected) selected.minViewEvidence = value;
        });
        reset.on('click', () => {
            if (selected) {
                selected.maxViewUncertainty = 1;
                selected.minViewEvidence = 0;
            }
        });
        events.on('selection.changed', (splat: Splat) => {
            selected = splat;
            update();
        });
        ['splat.replaced', 'splat.viewDependent'].forEach(event => events.on(event, (splat: Splat) => {
            if (splat === selected) update();
        }));
        i18n.onChange(update, this);
    }
}

export { ViewDependentControls };
