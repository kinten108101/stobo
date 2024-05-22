The list view in Stobo should behave the same as it does in Nautilus etc. Currently there's no standard/sharable API so we have to manually implement this behavior. As it currently stands the behavior is as follows:

csv-table:: Nautilus selection behavior
:header: "", "At item", "In empty area"
"Left click",                  "Select",                  "Nothing"
"Right click",                 "Select + Context menu",   "Context menu"
"Left click after selection",  "Run",                     "Deselect"
"Right click after selection", "Context menu",            "Deselect + Context menu"
