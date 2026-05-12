module Main exposing (main)

import Browser
import Html exposing (Html, a, button, div, h1, h2, p, section, span, text)
import Html.Attributes exposing (class, href, style, type_)
import Html.Events exposing (onClick)


main : Program () Model Msg
main =
    Browser.sandbox
        { init = init
        , update = update
        , view = view
        }


type alias Model =
    {}


type Msg
    = NoOp


init : Model
init =
    {}


update : Msg -> Model -> Model
update _ model =
    model


view : Model -> Html Msg
view _ =
    div [ class "min-h-screen bg-gray-50" ]
        [ section [ class "max-w-3xl mx-auto px-6 py-24" ]
            [ h1
                [ class "text-5xl font-bold tracking-tight text-gray-900" ]
                [ text "Hello from Elm" ]
            , p
                [ class "mt-6 text-lg text-gray-600 leading-relaxed" ]
                [ text "Replace this body with the actual prototype." ]
            , a
                [ class "mt-10 inline-flex items-center px-5 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700"
                , href "#"
                ]
                [ text "Primary action" ]
            ]
        ]
