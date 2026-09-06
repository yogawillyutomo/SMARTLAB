<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidatesClosedAssetPayload;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class LinkAssetDeviceRequest extends FormRequest
{
    use ValidatesClosedAssetPayload;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'deviceId' => ['required', 'ulid'],
            'id' => ['prohibited'],
            'assetId' => ['prohibited'],
            'schoolId' => ['prohibited'],
            'linkedDeviceId' => ['prohibited'],
            'version' => ['prohibited'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownAssetFields(
            $validator,
            ['deviceId', 'id', 'assetId', 'schoolId', 'linkedDeviceId', 'version'],
        ));
    }
}
