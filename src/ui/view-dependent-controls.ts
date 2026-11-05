import { Button, ColorPicker, Container, Label, SelectInput, SliderInput } from '@playcanvas/pcui';
import { Color } from 'playcanvas';

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
        const minUncertainty = slider('panel.view-dependent.min-uncertainty', 'min-view-uncertainty', 1, 0);
        const maxUncertainty = slider('panel.view-dependent.max-uncertainty', 'max-view-uncertainty', 1, 1);
        const minEvidence = slider('panel.view-dependent.min-evidence', 'min-view-evidence', 1, 0);
        const maxEvidence = slider('panel.view-dependent.max-evidence', 'max-view-evidence', 1, 1);
        minEvidence.max = undefined;
        maxEvidence.max = undefined;

        const modeRow = new Container({ class: 'view-dependent-row' });
        const modeLabel = new Label({ class: 'view-dependent-label' });
        i18n.bindText(modeLabel, 'panel.view-dependent.outside-range');
        const mode = new SelectInput({
            id: 'outside-threshold-mode',
            class: 'view-dependent-select',
            defaultValue: 'hide'
        });
        i18n.bindOptions(mode, () => [
            { v: 'hide', t: i18n.t('panel.view-dependent.outside-hide') },
            { v: 'color', t: i18n.t('panel.view-dependent.outside-color') }
        ]);
        modeRow.append(modeLabel);
        modeRow.append(mode);
        this.append(modeRow);

        const colorRow = new Container({ class: 'view-dependent-row', hidden: true });
        const colorLabel = new Label({ class: 'view-dependent-label' });
        i18n.bindText(colorLabel, 'panel.view-dependent.fallback-color');
        const colorPicker = new ColorPicker({
            id: 'outside-threshold-color',
            class: 'view-dependent-color',
            channels: 3,
            value: [1, 1, 1]
        });
        colorRow.append(colorLabel);
        colorRow.append(colorPicker);
        this.append(colorRow);

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
            minUncertainty.enabled = maxUncertainty.enabled = (data?.uncertaintyLayer ?? -1) >= 0;
            minEvidence.enabled = maxEvidence.enabled = (data?.evidenceLayer ?? -1) >= 0;
            // An unlimited evidence cap is shown at a conservative upper bound
            // for this frame. Both numeric inputs can also exceed that bound.
            const evidenceRange = Math.max(data?.evidenceMax ?? 1, selected?.minViewEvidence ?? 0, selected?.maxViewEvidence ?? 0);
            minEvidence.sliderMax = maxEvidence.sliderMax = evidenceRange;
            minUncertainty.value = selected?.minViewUncertainty ?? 0;
            maxUncertainty.value = selected?.maxViewUncertainty ?? 1;
            minEvidence.value = selected?.minViewEvidence ?? 0;
            maxEvidence.value = selected?.maxViewEvidence ?? evidenceRange;
            reset.enabled = minUncertainty.enabled || minEvidence.enabled;
            mode.enabled = reset.enabled;
            mode.value = selected?.outsideThresholdMode ?? 'hide';
            colorRow.hidden = !reset.enabled || mode.value !== 'color';
            const color = selected?.outsideThresholdColor;
            colorPicker.value = color ? [color.r, color.g, color.b] : [1, 1, 1];
            note.text = i18n.t(reset.enabled ? 'panel.view-dependent.note' : 'panel.view-dependent.missing');
            updating = false;
        };

        minUncertainty.on('change', (value: number) => {
            if (!updating && selected) selected.minViewUncertainty = value;
        });
        maxUncertainty.on('change', (value: number) => {
            if (!updating && selected) selected.maxViewUncertainty = value;
        });
        minEvidence.on('change', (value: number) => {
            if (!updating && selected) selected.minViewEvidence = value;
        });
        maxEvidence.on('change', (value: number) => {
            if (!updating && selected) selected.maxViewEvidence = value;
        });
        mode.on('change', (value: 'hide' | 'color') => {
            if (!updating && selected) selected.outsideThresholdMode = value;
        });
        colorPicker.on('change', (value: number[]) => {
            if (!updating && selected) selected.outsideThresholdColor = new Color(value[0], value[1], value[2]);
        });
        reset.on('click', () => {
            if (selected) {
                selected.minViewUncertainty = 0;
                selected.maxViewUncertainty = 1;
                selected.maxViewEvidence = null;
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
