<?php

namespace App\Http\Requests;

use App\Domain\Asset\AssetCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ReturnLoanRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'items' => ['required', 'array', 'min:1', 'max:20'],
            'items.*' => ['required', 'array'],
            'items.*.loanItemId' => ['required', 'ulid', 'distinct'],
            'items.*.conditionReturn' => ['required', Rule::in(AssetCatalog::CONDITIONS)],
            'items.*.returnNotes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, ['items']);
            $this->rejectUnknownQueryFields($validator, []);

            $items = $this->input('items');
            if (! is_array($items)) {
                return;
            }

            foreach ($items as $index => $item) {
                if (! is_array($item)) {
                    continue;
                }

                foreach (array_diff(array_keys($item), ['loanItemId', 'conditionReturn', 'returnNotes']) as $field) {
                    $validator->errors()->add("items.{$index}.{$field}", "The items.{$index}.{$field} field is prohibited.");
                }
            }
        });
    }
}
