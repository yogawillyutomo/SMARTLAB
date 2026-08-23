<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireLayoutVersionPrecondition
{
    public const ATTRIBUTE = 'layout_expected_version';

    public function handle(Request $request, Closure $next): Response
    {
        $header = $request->headers->get('If-Match');
        if (! is_string($header) || preg_match('/^"([1-9][0-9]*)"$/', $header, $matches) !== 1) {
            return $this->required();
        }

        $version = filter_var($matches[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($version === false) {
            return $this->required();
        }

        $request->attributes->set(self::ATTRIBUTE, $version);

        return $next($request);
    }

    private function required(): Response
    {
        return response()->json([
            'message' => 'A valid If-Match Layout version is required.',
            'code' => 'PRECONDITION_REQUIRED',
        ], 428);
    }
}
