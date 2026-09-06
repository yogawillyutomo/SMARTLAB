<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidatesClosedAssetPayload;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class AssetReasonRequest extends FormRequest
{
    use ValidatesClosedAssetPayload;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('reason'))) {
            $this->merge(['reason' => trim((string) $this->input('reason'))]);
        }
    }

    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
            'id' => ['prohibited'],
            'assetId' => ['prohibited'],
            'schoolId' => ['prohibited'],
            'version' => ['prohibited'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownAssetFields(
            $validator,
            ['reason', 'id', 'assetId', 'schoolId', 'version'],
        ));
    }
}
