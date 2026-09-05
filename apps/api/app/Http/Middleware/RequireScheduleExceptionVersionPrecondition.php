<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireScheduleExceptionVersionPrecondition
{
    public const ATTRIBUTE = 'schedule_exception_expected_version';

    public function handle(Request $request, Closure $next): Response
    {
        $header = $request->headers->get('If-Match');

        if (! is_string($header) || preg_match('/^"([1-9][0-9]*)"$/', $header, $matches) !== 1) {
            return response()->json([
                'message' => 'A valid If-Match Schedule Exception version is required.',
                'code' => 'PRECONDITION_REQUIRED',
            ], 428);
        }

        $version = filter_var($matches[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($version === false) {
            return response()->json([
                'message' => 'A valid If-Match Schedule Exception version is required.',
                'code' => 'PRECONDITION_REQUIRED',
            ], 428);
        }

        $request->attributes->set(self::ATTRIBUTE, $version);

        return $next($request);
    }
}
