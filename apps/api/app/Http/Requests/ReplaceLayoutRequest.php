<?php

namespace App\Http\Requests;

use App\Domain\Layout\LayoutCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ReplaceLayoutRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'name', 'templateKey', 'rows', 'columns', 'structuralElements', 'devicePlacements',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $normalized = [];
        foreach (['name', 'templateKey'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $normalized[$field] = $field === 'templateKey' && $value === '' ? null : $value;
            }
        }
        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:1', 'max:255'],
            'templateKey' => ['present', 'nullable', 'string', 'max:100'],
            'rows' => ['required', 'integer', 'min:1', 'max:50'],
            'columns' => ['required', 'integer', 'min:1', 'max:50'],
            'structuralElements' => ['present', 'array', 'max:2500'],
            'structuralElements.*' => ['required', 'array:id,type,label,row,column,rowSpan,columnSpan,rotation'],
            'structuralElements.*.id' => ['sometimes', 'string', 'ulid', 'distinct'],
            'structuralElements.*.type' => ['required', 'string', Rule::in(LayoutCatalog::STRUCTURAL_TYPES)],
            'structuralElements.*.label' => ['sometimes', 'nullable', 'string', 'max:60'],
            'structuralElements.*.row' => ['required', 'integer', 'min:1'],
            'structuralElements.*.column' => ['required', 'integer', 'min:1'],
            'structuralElements.*.rowSpan' => ['required', 'integer', 'min:1'],
            'structuralElements.*.columnSpan' => ['required', 'integer', 'min:1'],
            'structuralElements.*.rotation' => ['required', 'integer', Rule::in(LayoutCatalog::ROTATIONS)],
            'devicePlacements' => ['present', 'array', 'max:2500'],
            'devicePlacements.*' => ['required', 'array:id,deviceId,role,label,row,column,rowSpan,columnSpan,rotation'],
            'devicePlacements.*.id' => ['sometimes', 'string', 'ulid', 'distinct'],
            'devicePlacements.*.deviceId' => ['required', 'string', 'ulid'],
            'devicePlacements.*.role' => ['sometimes', 'nullable', 'string', Rule::in(LayoutCatalog::PLACEMENT_ROLES)],
            'devicePlacements.*.label' => ['sometimes', 'nullable', 'string', 'max:60'],
            'devicePlacements.*.row' => ['required', 'integer', 'min:1'],
            'devicePlacements.*.column' => ['required', 'integer', 'min:1'],
            'devicePlacements.*.rowSpan' => ['required', 'integer', 'min:1'],
            'devicePlacements.*.columnSpan' => ['required', 'integer', 'min:1'],
            'devicePlacements.*.rotation' => ['required', 'integer', Rule::in(LayoutCatalog::ROTATIONS)],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);

            foreach ((array) $this->input('structuralElements', []) as $index => $element) {
                if (! is_array($element) || ! isset($element['type'])) {
                    continue;
                }
                $label = $element['label'] ?? null;
                if ($element['type'] === 'aisle' && $label !== null && trim((string) $label) !== '') {
                    $validator->errors()->add("structuralElements.{$index}.label", 'An aisle cannot have a label.');
                }
                if ($element['type'] === 'label' && (! is_string($label) || trim($label) === '')) {
                    $validator->errors()->add("structuralElements.{$index}.label", 'A label element requires nonblank text.');
                }
            }
        });
    }
}
