<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ListAssetQrLabelBatchesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'laboratoryId' => ['sometimes', 'nullable', 'ulid'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }
}
