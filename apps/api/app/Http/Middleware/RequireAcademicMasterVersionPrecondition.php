<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireAcademicMasterVersionPrecondition
{
    public const ATTRIBUTE = 'academic_master_expected_version';

    public function handle(Request $request, Closure $next): Response
    {
        $header = $request->headers->get('If-Match');
        if (! is_string($header) || preg_match('/^"([1-9][0-9]*)"$/', $header, $matches) !== 1) {
            return $this->invalidPrecondition();
        }

        $version = filter_var($matches[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($version === false) {
            return $this->invalidPrecondition();
        }

        $request->attributes->set(self::ATTRIBUTE, $version);

        return $next($request);
    }

    private function invalidPrecondition(): Response
    {
        return response()->json([
            'message' => 'A valid If-Match Academic Master version is required.',
            'code' => 'PRECONDITION_REQUIRED',
        ], 428);
    }
}
