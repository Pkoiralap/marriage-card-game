from django.conf import settings


class NoCacheStaticMiddleware:
    """In DEBUG, tell browsers never to cache static assets.

    The frontend is a set of ES modules that import each other. If the browser
    caches one stale module while another updates, you get version mismatches
    (e.g. GameController calling a method a cached InputHandler doesn't have yet),
    which surface as confusing runtime errors. Disabling the cache in dev makes
    every reload load a consistent set of files.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        static_prefix = "/" + settings.STATIC_URL.lstrip("/")  # e.g. "static/" -> "/static/"
        if settings.DEBUG and request.path.startswith(static_prefix):
            response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response
