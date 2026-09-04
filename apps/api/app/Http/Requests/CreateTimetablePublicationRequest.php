<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use Normalizer;

class CreateTimetablePublicationRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'schemaVersion',
        'sourceSystem',
        'sourcePublicationId',
        'sourceVersion',
        'academicReferenceSource',
        'schoolSourceId',
        'academicYearSourceId',
        'semesterSourceId',
        'publishedAt',
        'effectiveFrom',
        'effectiveTo',
        'entries',
    ];

    private const ENTRY_FIELDS = [
        'sourceScheduleId',
        'teacherSourceId',
        'academicClassSourceId',
        'subjectSourceId',
        'lessonPeriodSetSourceId',
        'startLessonPeriodSourceId',
        'endLessonPeriodSourceId',
        'plannedLaboratoryId',
        'activityType',
        'recurrenceKind',
        'weekday',
        'entryEffectiveFrom',
        'entryEffectiveTo',
        'occursOn',
        'sourceSnapshots',
    ];

    private const SNAPSHOT_FIELDS = [
        'teacherCode',
        'teacherName',
        'classCode',
        'className',
        'subjectCode',
        'subjectName',
        'laboratoryCode',
        'laboratoryName',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $normalized = [];

        foreach (['schemaVersion', 'sourcePublicationId', 'schoolSourceId', 'academicYearSourceId', 'semesterSourceId'] as $field) {
            if (is_string($this->input($field))) {
                $normalized[$field] = $this->text((string) $this->input($field));
            }
        }

        foreach (['sourceSystem', 'academicReferenceSource'] as $field) {
            if (is_string($this->input($field))) {
                $normalized[$field] = mb_strtolower($this->text((string) $this->input($field)));
            }
        }

        $entries = $this->input('entries');
        if (is_array($entries)) {
            $normalizedEntries = [];
            foreach ($entries as $entry) {
                if (! is_array($entry)) {
                    $normalizedEntries[] = $entry;

                    continue;
                }

                foreach ([
                    'sourceScheduleId',
                    'teacherSourceId',
                    'academicClassSourceId',
                    'subjectSourceId',
                    'lessonPeriodSetSourceId',
                    'startLessonPeriodSourceId',
                    'endLessonPeriodSourceId',
                    'plannedLaboratoryId',
                ] as $field) {
                    if (isset($entry[$field]) && is_string($entry[$field])) {
                        $entry[$field] = $this->text($entry[$field]);
                    }
                }

                foreach (['activityType', 'recurrenceKind'] as $field) {
                    if (isset($entry[$field]) && is_string($entry[$field])) {
                        $entry[$field] = mb_strtolower($this->text($entry[$field]));
                    }
                }

                if (isset($entry['sourceSnapshots']) && is_array($entry['sourceSnapshots'])) {
                    foreach ($entry['sourceSnapshots'] as $key => $value) {
                        if (is_string($value)) {
                            $entry['sourceSnapshots'][$key] = $this->text($value);
                        }
                    }
                }

                $normalizedEntries[] = $entry;
            }

            $normalized['entries'] = $normalizedEntries;
        }

        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    public function rules(): array
    {
        return [
            'schemaVersion' => ['required', 'string', Rule::in(['1.0'])],
            'sourceSystem' => ['required', 'string', Rule::in(['tessela'])],
            'sourcePublicationId' => ['required', 'string', 'min:1', 'max:128'],
            'sourceVersion' => ['required', 'integer', 'min:1'],
            'academicReferenceSource' => ['required', 'string', Rule::in(['smartlab'])],
            'schoolSourceId' => ['required', 'string', 'min:1', 'max:128'],
            'academicYearSourceId' => ['required', 'string', 'min:1', 'max:128'],
            'semesterSourceId' => ['required', 'string', 'min:1', 'max:128'],
            'publishedAt' => ['required', 'date'],
            'effectiveFrom' => ['required', 'date_format:Y-m-d'],
            'effectiveTo' => ['required', 'date_format:Y-m-d', 'after_or_equal:effectiveFrom'],
            'entries' => ['required', 'array', 'min:1', 'max:5000'],
            'entries.*' => ['required', 'array:'.implode(',', self::ENTRY_FIELDS)],
            'entries.*.sourceScheduleId' => ['required', 'string', 'min:1', 'max:128', 'distinct:strict'],
            'entries.*.teacherSourceId' => ['required', 'string', 'min:1', 'max:128'],
            'entries.*.academicClassSourceId' => ['required', 'string', 'min:1', 'max:128'],
            'entries.*.subjectSourceId' => ['required', 'string', 'min:1', 'max:128'],
            'entries.*.lessonPeriodSetSourceId' => ['required', 'string', 'min:1', 'max:128'],
            'entries.*.startLessonPeriodSourceId' => ['required', 'string', 'min:1', 'max:128'],
            'entries.*.endLessonPeriodSourceId' => ['required', 'string', 'min:1', 'max:128'],
            'entries.*.plannedLaboratoryId' => ['nullable', 'string', 'min:1', 'max:128'],
            'entries.*.activityType' => ['required', 'string', Rule::in(['practical', 'theory', 'exam', 'other'])],
            'entries.*.recurrenceKind' => ['required', 'string', Rule::in(['weekly', 'single_date'])],
            'entries.*.weekday' => ['nullable', 'integer', 'between:1,7'],
            'entries.*.entryEffectiveFrom' => ['nullable', 'date_format:Y-m-d'],
            'entries.*.entryEffectiveTo' => ['nullable', 'date_format:Y-m-d'],
            'entries.*.occursOn' => ['nullable', 'date_format:Y-m-d'],
            'entries.*.sourceSnapshots' => ['nullable', 'array:'.implode(',', self::SNAPSHOT_FIELDS)],
            'entries.*.sourceSnapshots.*' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);

            foreach ((array) $this->input('entries', []) as $index => $entry) {
                if (! is_array($entry)) {
                    continue;
                }

                $kind = $entry['recurrenceKind'] ?? null;
                if ($kind === 'weekly') {
                    foreach (['weekday', 'entryEffectiveFrom', 'entryEffectiveTo'] as $field) {
                        if (! array_key_exists($field, $entry) || $entry[$field] === null || $entry[$field] === '') {
                            $validator->errors()->add("entries.{$index}.{$field}", "The {$field} field is required for weekly recurrence.");
                        }
                    }

                    if (isset($entry['entryEffectiveFrom'], $entry['entryEffectiveTo'])
                        && is_string($entry['entryEffectiveFrom'])
                        && is_string($entry['entryEffectiveTo'])
                        && $entry['entryEffectiveFrom'] > $entry['entryEffectiveTo']) {
                        $validator->errors()->add("entries.{$index}.entryEffectiveTo", 'The entry effective end must be on or after the start.');
                    }

                    if (array_key_exists('occursOn', $entry) && $entry['occursOn'] !== null && $entry['occursOn'] !== '') {
                        $validator->errors()->add("entries.{$index}.occursOn", 'The occursOn field is prohibited for weekly recurrence.');
                    }
                }

                if ($kind === 'single_date') {
                    if (! array_key_exists('occursOn', $entry) || $entry['occursOn'] === null || $entry['occursOn'] === '') {
                        $validator->errors()->add("entries.{$index}.occursOn", 'The occursOn field is required for single-date recurrence.');
                    }

                    foreach (['weekday', 'entryEffectiveFrom', 'entryEffectiveTo'] as $field) {
                        if (array_key_exists($field, $entry) && $entry[$field] !== null && $entry[$field] !== '') {
                            $validator->errors()->add("entries.{$index}.{$field}", "The {$field} field is prohibited for single-date recurrence.");
                        }
                    }
                }
            }
        });
    }

    private function text(string $value): string
    {
        $trimmed = trim($value);
        $normalized = Normalizer::normalize($trimmed, Normalizer::FORM_C);

        return $normalized === false ? $trimmed : $normalized;
    }
}
