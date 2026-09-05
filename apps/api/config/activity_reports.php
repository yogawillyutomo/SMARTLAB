<?php

return [
    'attachments' => [
        'disk' => env('ACTIVITY_REPORT_ATTACHMENT_DISK', 'local'),
        'max_kilobytes' => (int) env('ACTIVITY_REPORT_ATTACHMENT_MAX_KB', 10240),
        'media_types' => [
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/pdf',
        ],
    ],
];
