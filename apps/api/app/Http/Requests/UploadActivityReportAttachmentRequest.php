<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class UploadActivityReportAttachmentRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        $max = max(1, (int) config('activity_reports.attachments.max_kilobytes', 10240));
        $types = implode(',', (array) config('activity_reports.attachments.media_types', []));

        return [
            'file' => ['required', 'file', 'max:'.$max, 'mimetypes:'.$types],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, ['file']);
            $this->rejectUnknownQueryFields($validator, []);
        });
    }
}
