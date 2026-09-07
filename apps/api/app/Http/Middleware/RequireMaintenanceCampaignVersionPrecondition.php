<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireMaintenanceCampaignVersionPrecondition
{
    public const ATTRIBUTE = 'maintenance_campaign_expected_version';

    public function handle(Request $request, Closure $next): Response
    {
        $header = $request->headers->get('If-Match');
        if (! is_string($header) || preg_match('/^"([1-9][0-9]*)"$/', $header, $matches) !== 1) {
            return response()->json([
                'message' => 'A valid If-Match MaintenanceCampaign version is required.',
                'code' => 'PRECONDITION_REQUIRED',
            ], 428);
        }

        $request->attributes->set(self::ATTRIBUTE, (int) $matches[1]);

        return $next($request);
    }
}
