from PyInstaller.utils.win32.versioninfo import (
    VarStruct, VarFileInfo, StringStruct, StringTable,
    StringFileInfo, FixedFileInfo, VSVersionInfo
)

VSVersionInfo(
    ffi=FixedFileInfo(
        filevers=(1, 0, 0, 0),
        prodvers=(1, 0, 0, 0),
        mask=0x3F,
        flags=0x0,
        OS=0x40004,
        fileType=0x1,
        subtype=0x0,
        date=(0, 0),
    ),
    kids=[
        StringFileInfo([
            StringTable(
                "040904B0",
                [
                    StringStruct("CompanyName",       "DocSuiteKit Project"),
                    StringStruct("FileDescription",   "DocSuiteKit Document Processing Suite"),
                    StringStruct("FileVersion",       "1.0.0.0"),
                    StringStruct("InternalName",      "DocSuiteKit"),
                    StringStruct("LegalCopyright",    "© 2025 DocSuiteKit Project."),
                    StringStruct("OriginalFilename",  "DocSuiteKit.exe"),
                    StringStruct("ProductName",       "DocSuiteKit"),
                    StringStruct("ProductVersion",    "1.0.0.0"),
                ],
            )
        ]),
        VarFileInfo([VarStruct("Translation", [0x0409, 1200])]),
    ],
)
